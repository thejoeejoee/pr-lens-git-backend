import type { GitLabSettings } from "../config.ts";
import {
  isCanvasRecord,
  StoreThrottled,
  StoreUnavailable,
  type CanvasRecord,
  type Store,
  type Stored,
  type WriteResult,
} from "./types.ts";

/**
 * A GitLab repository as the canvas store.
 *
 * One JSON file per canvas, written through the Commits API. The reason to use
 * commits rather than the simpler file endpoints is `last_commit_id`: GitLab
 * refuses an update whose stated parent is no longer the blob's last commit,
 * which is a real compare-and-swap and therefore exactly what `If-Match` needs.
 * Without it two writers on the same revision would both appear to win.
 *
 * What the repository gets in return is the revision history for free — every
 * push is a commit, so `git log` over a canvas file is the list of revisions
 * the API deliberately does not expose.
 *
 * Files are sharded by the first two characters of the id. Nothing reads a
 * directory listing; the shard exists only to keep the tree from growing one
 * enormous directory as canvases accumulate.
 */

/** GitLab's phrasing for "the blob moved under you". Matched, not parsed. */
const FILE_CHANGED = /has changed since you started editing/i;
const ALREADY_EXISTS = /already exists/i;
/** Two commits raced for the branch tip; the file itself may be untouched. */
const BRANCH_MOVED =
  /could not update|stale|cannot be merged|reference update failed/i;
const NO_BRANCH = /branch.*(not found|does not exist)|invalid branch/i;

const BRANCH_RETRIES = 4;

type CommitAction = {
  action: "create" | "update" | "delete";
  file_path: string;
  content?: string;
  encoding?: "base64";
  last_commit_id?: string;
};

type Answer = { status: number; body: unknown; text: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const messageOf = (body: unknown): string => {
  if (typeof body !== "object" || body === null) return "";
  const withMessage = body as { message?: unknown; error?: unknown };
  if (typeof withMessage.message === "string") return withMessage.message;
  if (typeof withMessage.error === "string") return withMessage.error;
  // GitLab also answers { message: { branch: ["..."] } } on validation errors.
  if (typeof withMessage.message === "object" && withMessage.message !== null)
    return JSON.stringify(withMessage.message);
  return "";
};

export class GitLabStore implements Store {
  readonly #settings: GitLabSettings;
  readonly #project: string;

  constructor(settings: GitLabSettings) {
    this.#settings = settings;
    // A path like "group/sub/repo" has to arrive as one path segment.
    this.#project = encodeURIComponent(settings.project);
  }

  #path(id: string): string {
    const shard = id.slice(0, 2);
    const prefix = this.#settings.prefix === "" ? "" : `${this.#settings.prefix}/`;
    return `${prefix}${shard}/${id}.json`;
  }

  async #call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Answer> {
    const url = `${this.#settings.baseUrl}/api/v4/projects/${this.#project}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "private-token": this.#settings.token,
          accept: "application/json",
          ...(body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Comfortably inside the 60 seconds the CLI gives the whole request.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      throw new StoreUnavailable(`GitLab did not answer ${method} ${path}`, cause);
    }

    const text = await response.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    if (response.status === 429) {
      const after = Number(response.headers.get("retry-after") ?? "60");
      const seconds = Number.isFinite(after) && after > 0 ? after : 60;
      throw new StoreThrottled(
        new Date(Date.now() + seconds * 1000),
        "This server's own store is rate limiting it; try again shortly",
      );
    }

    return { status: response.status, body: parsed, text };
  }

  /**
   * One commit, with `last_commit_id` doing the compare-and-swap.
   *
   * A refusal splits three ways. The blob moved, or the file already exists:
   * that is a genuine conflict and the caller has to re-read. The branch tip
   * moved: another canvas was written at the same moment, our own parent is
   * still good, so the same commit is worth retrying. Anything else is a fault.
   */
  async #commit(message: string, action: CommitAction): Promise<WriteResult> {
    for (let attempt = 0; ; attempt += 1) {
      const answer = await this.#call("POST", "/repository/commits", {
        branch: this.#settings.branch,
        commit_message: message,
        author_name: this.#settings.authorName,
        author_email: this.#settings.authorEmail,
        actions: [action],
        // Harmless when the branch exists; the one thing that makes the very
        // first commit into an empty repository work.
        ...(action.action === "create"
          ? { start_branch: this.#settings.branch }
          : {}),
      });

      if (answer.status >= 200 && answer.status < 300) return "written";

      const detail = messageOf(answer.body) || answer.text;

      if (answer.status === 400 || answer.status === 409) {
        if (FILE_CHANGED.test(detail) || ALREADY_EXISTS.test(detail))
          return "conflict";

        if (
          (BRANCH_MOVED.test(detail) || NO_BRANCH.test(detail)) &&
          attempt < BRANCH_RETRIES
        ) {
          // Jittered, so a burst of pushes does not re-collide in lockstep.
          await sleep(50 * 2 ** attempt + Math.floor(Math.random() * 50));
          continue;
        }
      }

      if (answer.status === 404 && action.action !== "create") return "conflict";

      throw new StoreUnavailable(
        `GitLab refused a commit with ${answer.status}: ${detail}`,
      );
    }
  }

  async read(id: string): Promise<Stored | null> {
    const file = encodeURIComponent(this.#path(id));
    const ref = encodeURIComponent(this.#settings.branch);
    const answer = await this.#call(
      "GET",
      `/repository/files/${file}?ref=${ref}`,
    );

    // A missing file and a missing branch are both "no such canvas" here.
    if (answer.status === 404) return null;
    if (answer.status < 200 || answer.status >= 300)
      throw new StoreUnavailable(
        `GitLab answered ${answer.status} reading ${id}: ${messageOf(answer.body) || answer.text}`,
      );

    const file_ = answer.body as {
      content?: unknown;
      encoding?: unknown;
      last_commit_id?: unknown;
    };
    if (
      typeof file_.content !== "string" ||
      typeof file_.last_commit_id !== "string"
    )
      throw new StoreUnavailable(`GitLab answered without a blob for ${id}`);

    const raw = Buffer.from(
      file_.content,
      file_.encoding === "base64" ? "base64" : "utf8",
    ).toString("utf8");

    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch (cause) {
      throw new StoreUnavailable(`${this.#path(id)} is not JSON`, cause);
    }

    if (!isCanvasRecord(record))
      throw new StoreUnavailable(`${this.#path(id)} is not a canvas record`);

    // The path is the authority on identity; a copied file must not answer for
    // the id it was copied from.
    if (record.id !== id)
      throw new StoreUnavailable(
        `${this.#path(id)} holds canvas ${record.id}`,
      );

    return { record, etag: file_.last_commit_id };
  }

  async create(record: CanvasRecord): Promise<WriteResult> {
    return this.#commit(`canvas ${record.id}: mint`, {
      action: "create",
      file_path: this.#path(record.id),
      content: serialise(record),
      encoding: "base64",
    });
  }

  async replace(record: CanvasRecord, etag: string): Promise<WriteResult> {
    return this.#commit(`canvas ${record.id}: rev ${record.rev}`, {
      action: "update",
      file_path: this.#path(record.id),
      content: serialise(record),
      encoding: "base64",
      last_commit_id: etag,
    });
  }

  async remove(id: string, etag: string): Promise<WriteResult> {
    return this.#commit(`canvas ${id}: delete`, {
      action: "delete",
      file_path: this.#path(id),
      last_commit_id: etag,
    });
  }

  async ping(): Promise<void> {
    const answer = await this.#call("GET", "");
    if (answer.status < 200 || answer.status >= 300)
      throw new StoreUnavailable(
        `GitLab answered ${answer.status} for the project: ${messageOf(answer.body) || answer.text}`,
      );
  }
}

/**
 * Base64 rather than raw text, so a document holding any byte sequence
 * survives the round trip without GitLab guessing at an encoding.
 */
const serialise = (record: CanvasRecord): string =>
  Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8").toString("base64");

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { GitSettings } from "../config.ts";
import {
  isCanvasRecord,
  type Count,
  StoreThrottled,
  StoreUnavailable,
  type CanvasRecord,
  type Store,
  type Stored,
  type WriteResult,
} from "./types.ts";

/**
 * A git repository as the canvas store — any repository, on any host that
 * speaks git.
 *
 * One JSON file per canvas, one commit per write, and the compare-and-swap that
 * `If-Match` needs comes from two things git already guarantees:
 *
 *   - **the blob's object id is the etag.** A read hands back the id of the
 *     exact bytes it read, and a write refuses unless the path still holds
 *     those bytes. Two writers on the same revision read the same id; the
 *     second one to arrive finds a different one and is told the revision
 *     moved. Content addressing makes this free and exact, where the GitLab API
 *     needed a commit id and a history walk to find it.
 *   - **a push is fast-forward or nothing.** The commit is composed on the tip
 *     this replica last fetched, so if another replica committed in between,
 *     the remote refuses the push. That refusal is not a conflict by itself —
 *     usually somebody wrote a *different* canvas — so it re-fetches, checks
 *     the blob again, and either rebuilds on the new tip or reports the
 *     conflict it now really is.
 *
 * Nothing is checked out. Every write is plumbing over a throwaway index:
 * `hash-object` for the blob, `read-tree`/`update-index`/`write-tree` for the
 * tree, `commit-tree` for the commit, `push` for the compare-and-swap. The
 * local mirror is a cache and holds no truth the remote does not, so deleting
 * it costs a clone and nothing else.
 *
 * Files are sharded by the first two characters of the id. Nothing reads a
 * directory listing; the shard exists only to keep the tree from growing one
 * enormous directory as canvases accumulate.
 */

/**
 * The remote said no for a reason that will still be true next time: a hook, a
 * protected branch, a credential. Checked before the retryable wordings,
 * because a declined push also prints "failed to push some refs".
 */
const DECLINED =
  /hook declined|protected branch|permission denied|access denied|not authorized|unauthorized|authentication failed|could not read (?:username|password)|repository not found|does not appear to be a git repository/i;

/**
 * The tip moved under us. Worth composing again on the new tip — the file this
 * write is about may not have been touched at all.
 */
const REJECTED =
  /\[rejected\]|non-fast-forward|fetch first|stale info|cannot lock ref|failed to push some refs|reference update|does not point to expected object/i;

/** The host is asking to be left alone. Becomes RATE_LIMITED with a time. */
const THROTTLED = /\b429\b|too many requests|rate limit/i;

/** A branch that does not exist yet is not a failure; it is an empty store. */
const NO_REF = /couldn't find remote ref|no such ref|not our ref/i;

/**
 * How many times a write will compose again after losing the branch tip.
 *
 * Every write in the deployment contends for one tip, so N writers landing at
 * once need about N rounds to drain — and the pod's own writes are queued rather
 * than raced (see `#write`), which makes N the number of pods rather than the
 * number of requests in flight. This is sized for that smaller N with room to
 * spare; past it the answer is that the branch will not settle, which is the
 * truth and not a lost write.
 */
const PUSH_RETRIES = 12;

/** Backoff between rounds, capped so a long tail cannot outlive the request. */
const BACKOFF_CEILING_MS = 800;

/**
 * How long to tell a caller to wait when the host says 429. A constant, because
 * git surfaces no `Retry-After` to pass on.
 */
const THROTTLE_RETRY_MS = 60_000;

/** Stops a runaway `ls-tree` or a hostile blob from becoming this process. */
const MAX_OUTPUT_BYTES = 64_000_000;

type Run = { code: number; stdout: Buffer; stderr: string };

/** What the caller believes the path holds right now. */
type Expected = { kind: "absent" } | { kind: "blob"; oid: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The tail of what git said, which is the part that says why. */
const lastLines = (text: string): string =>
  text.trim().split("\n").slice(-4).join("; ").slice(0, 500);

export class GitStore implements Store {
  readonly #settings: GitSettings;
  readonly #ref: string;

  /** The mirror exists and knows its remote. Retried if it ever failed. */
  #prepared: Promise<void> | undefined;
  /** True once that has finished, which is when it is worth re-checking. */
  #standing = false;
  /** Fetches, one after another. Two at once would only fight over ref locks. */
  #fetches: Promise<unknown> = Promise.resolve();
  /** Writes, one after another. Two at once would only fight over the branch tip. */
  #writes: Promise<unknown> = Promise.resolve();
  #fetchedAt = 0;

  constructor(settings: GitSettings) {
    this.#settings = settings;
    this.#ref = `refs/remotes/origin/${settings.branch}`;
  }

  #path(id: string): string {
    const shard = id.slice(0, 2);
    const prefix = this.#settings.prefix === "" ? "" : `${this.#settings.prefix}/`;
    return `${prefix}${shard}/${id}.json`;
  }

  /**
   * The environment every invocation runs in.
   *
   * The system and global config files are shut out so that this server behaves
   * the same on a laptop, in a container and in CI — a store whose conflict
   * handling depends on somebody's `~/.gitconfig` is not a store. What is *not*
   * shut out is the rest of the environment: `GIT_SSH_COMMAND` and friends are
   * how an ssh remote gets its key, and that is the operator's business.
   *
   * The token travels as config in the environment rather than as an argument
   * or in the remote URL: `ps` shows arguments, and a URL with a password in it
   * ends up in `git remote -v`, in error messages and in the mirror's config
   * file. `GIT_CONFIG_*` shows up in neither.
   */
  #env(index?: string): NodeJS.ProcessEnv {
    const { authorName, authorEmail, userAgent, token, username } = this.#settings;

    const config: [string, string][] = [
      ["http.userAgent", userAgent],
      // The mirror is append-only and disposable; a repack that fires in the
      // middle of a push is a stall nobody asked for.
      ["gc.auto", "0"],
      // Only ever one branch, fetched by full refspec.
      ["remote.origin.tagOpt", "--no-tags"],
    ];
    if (token !== undefined)
      config.push([
        "http.extraHeader",
        `Authorization: Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
      ]);

    const asEnv: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(config.length) };
    config.forEach(([key, value], at) => {
      asEnv[`GIT_CONFIG_KEY_${at}`] = key;
      asEnv[`GIT_CONFIG_VALUE_${at}`] = value;
    });

    return {
      ...process.env,
      ...asEnv,
      GIT_DIR: this.#settings.mirror,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      // Nobody is at the terminal to type a password, and a git that waits for
      // one is a request that never answers.
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: authorName,
      GIT_COMMITTER_EMAIL: authorEmail,
      // So the wordings above are the wordings that arrive.
      LC_ALL: "C",
      ...(index === undefined ? {} : { GIT_INDEX_FILE: index }),
    };
  }

  #git(
    args: string[],
    options: { stdin?: Buffer; index?: string } = {},
  ): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        env: this.#env(options.index),
        stdio: ["pipe", "pipe", "pipe"],
      });

      const out: Buffer[] = [];
      let bytes = 0;
      let stderr = "";
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(error);
      };

      const timer = setTimeout(
        () =>
          fail(
            new StoreUnavailable(
              `git ${args[0]} took longer than ${this.#settings.timeoutMs}ms`,
            ),
          ),
        this.#settings.timeoutMs,
      );

      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) {
          fail(new StoreUnavailable(`git ${args[0]} answered with too much`));
          return;
        }
        out.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-8_000);
      });

      child.on("error", (cause) =>
        fail(new StoreUnavailable(`git could not be run: ${cause.message}`, cause)),
      );
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr });
      });

      child.stdin.on("error", () => {
        // A command that exits before reading its input closes the pipe, which
        // is the command's answer, not a failure of its own.
      });
      child.stdin.end(options.stdin);
    });
  }

  /** The same, for the commands whose failure is never an answer. */
  async #must(
    args: string[],
    options: { stdin?: Buffer; index?: string } = {},
  ): Promise<Buffer> {
    const run = await this.#git(args, options);
    if (run.code !== 0) throw this.#refusal(`git ${args[0]}`, run.stderr);
    return run.stdout;
  }

  /** A command that answers by failing: missing objects, missing refs. */
  async #oid(rev: string): Promise<string | undefined> {
    const run = await this.#git(["rev-parse", "--verify", "--quiet", rev]);
    if (run.code !== 0) return undefined;
    const oid = run.stdout.toString("utf8").trim();
    return oid === "" ? undefined : oid;
  }

  #refusal(what: string, detail: string): Error {
    if (THROTTLED.test(detail))
      return new StoreThrottled(
        new Date(Date.now() + THROTTLE_RETRY_MS),
        "This server's own store is rate limiting it; try again shortly",
      );
    return new StoreUnavailable(`${what} failed: ${lastLines(detail)}`);
  }

  /** Whether the mirror is still a repository, rather than a deleted directory. */
  #alive(): Promise<boolean> {
    return stat(join(this.#settings.mirror, "HEAD")).then(
      () => true,
      () => false,
    );
  }

  async #prepare(): Promise<void> {
    // A mirror can vanish underneath a running server: a pod moves and takes
    // its emptyDir with it. One stat is cheap, and the alternative is answering
    // "no such canvas" for every canvas until somebody restarts the process.
    // Only ever asked once a build has finished, or two callers arriving
    // together would both find a half-built mirror and both try to build it.
    if (this.#standing && !(await this.#alive())) {
      this.#standing = false;
      this.#prepared = undefined;
    }

    // Held locally: #build clears the field when it fails, and a cleared field
    // would turn that failure into a silent success for whoever asked first.
    const prepared = (this.#prepared ??= this.#build());
    return prepared;
  }

  async #build(): Promise<void> {
    const { mirror, remote, branch } = this.#settings;
    try {
      await mkdir(mirror, { recursive: true });

      if (!(await this.#alive())) {
        await this.#must(["init", "--bare", "--quiet"]);
        // Cosmetic for a mirror nobody checks out, and the right answer for
        // anyone who clones it to look around.
        await this.#must(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
      }

      // Set rather than added, so a changed GIT_REMOTE takes effect on restart
      // instead of failing as "remote origin already exists".
      await this.#must(["config", "remote.origin.url", remote]);
      await this.#must([
        "config",
        "remote.origin.fetch",
        `+refs/heads/${branch}:${this.#ref}`,
      ]);
    } catch (error) {
      // A mirror that could not be built must not be remembered as built.
      this.#prepared = undefined;
      throw error;
    }
    this.#standing = true;
  }

  /**
   * Bring the mirror up to date with the remote.
   *
   * Fetches run one at a time and share their result: ten readers arriving
   * together want one fetch between them, and two fetches into one repository
   * would only queue on git's own ref lock anyway. A fetch that finished while
   * this one waited counts as this one's fetch — unless `force` asked, which is
   * what a refused push does, and that has to see the tip that refused it.
   */
  async #fetch(force = false): Promise<void> {
    const asked = Date.now();

    const next = this.#fetches.then(async () => {
      const { fetchTtlMs, branch } = this.#settings;
      if (!force) {
        if (this.#fetchedAt >= asked) return;
        if (fetchTtlMs > 0 && Date.now() - this.#fetchedAt < fetchTtlMs) return;
      }

      const run = await this.#git([
        "fetch",
        "--quiet",
        "--no-tags",
        "--prune",
        "origin",
        `+refs/heads/${branch}:${this.#ref}`,
      ]);

      // Nothing has ever been minted, so the branch is not there. Every read
      // answers null and the first create makes it.
      if (run.code !== 0 && !NO_REF.test(run.stderr))
        throw this.#refusal("git fetch", run.stderr);

      this.#fetchedAt = Date.now();
    });

    // The queue must not inherit a rejection, or one unreachable moment would
    // fail every fetch after it.
    this.#fetches = next.catch(() => {});
    return next;
  }

  /**
   * One write, and only one at a time from this process.
   *
   * Queued rather than raced, because racing here buys nothing: every write in
   * the deployment ends at the same branch tip, and the remote takes them one
   * at a time whatever we do. Two of this pod's own writes pushing together
   * means one of them is refused and has to compose again — the same work,
   * done twice, plus a round trip. Waiting is strictly cheaper, and it leaves
   * the contention that is actually unavoidable: one push per pod.
   *
   * It costs nothing in throughput for the same reason. What it does cost is a
   * queue behind a slow remote, bounded by `GIT_TIMEOUT_MS` per write.
   */
  #write(
    message: string,
    path: string,
    content: Buffer | undefined,
    expect: Expected,
  ): Promise<WriteResult> {
    const next = this.#writes.then(() =>
      this.#writeNow(message, path, content, expect),
    );
    // The queue must not inherit a rejection, or one failed write would fail
    // every write after it.
    this.#writes = next.catch(() => {});
    return next;
  }

  /**
   * Compose a commit on the tip we last saw, and push it.
   *
   * The compare-and-swap is checked twice over, and the second time is the one
   * that counts. Before composing, the blob at the path has to be what the
   * caller read — otherwise somebody has already written this canvas and the
   * answer is a conflict. After a refused push, the tip has moved, so the same
   * question is asked again against the new tip: still our blob, and the commit
   * is rebuilt and sent; a different blob, and the conflict is real.
   */
  async #writeNow(
    message: string,
    path: string,
    content: Buffer | undefined,
    expect: Expected,
  ): Promise<WriteResult> {
    await this.#prepare();

    for (let attempt = 0; ; attempt += 1) {
      await this.#fetch(attempt > 0);

      const tip = await this.#oid(`${this.#ref}^{commit}`);
      const held = await this.#oid(`${this.#ref}:${path}`);
      if (expect.kind === "absent" ? held !== undefined : held !== expect.oid)
        return "conflict";

      const commit = await this.#compose(tip, path, content, message);
      const push = await this.#git([
        "push",
        "--porcelain",
        "origin",
        `${commit}:refs/heads/${this.#settings.branch}`,
      ]);

      if (push.code === 0) {
        // The remote took it, so the mirror's idea of the branch is this commit
        // whatever else has happened since. Saves the next write a fetch it
        // would only use to learn what it already knows -- and if the mirror
        // will not take it, the next read is made to ask the remote instead.
        const synced = await this.#git(["update-ref", this.#ref, commit]);
        if (synced.code !== 0) this.#fetchedAt = 0;
        return "written";
      }

      const detail = `${push.stdout.toString("utf8")}\n${push.stderr}`;
      if (THROTTLED.test(detail) || DECLINED.test(detail) || !REJECTED.test(detail))
        throw this.#refusal("git push", detail);

      if (attempt >= PUSH_RETRIES)
        throw new StoreUnavailable(
          `${this.#settings.branch} would not settle after ${attempt + 1} pushes: ${lastLines(detail)}`,
        );

      // Jittered, so a burst of pushes does not re-collide in lockstep. The
      // jitter is the load-bearing half: without it every loser wakes together
      // and one of them wins again, which is how a burst starves its own tail.
      await sleep(
        Math.min(50 * 2 ** attempt, BACKOFF_CEILING_MS) +
          Math.floor(Math.random() * 250),
      );
    }
  }

  /**
   * A commit holding one changed path, built without a working tree.
   *
   * The index is a fresh file per write and deleted afterwards, so two writes
   * in flight at once cannot see each other's staging — the object database
   * underneath is append-only and safe to share, but one index file is not.
   */
  async #compose(
    tip: string | undefined,
    path: string,
    content: Buffer | undefined,
    message: string,
  ): Promise<string> {
    const index = join(this.#settings.mirror, `canvas-index-${randomUUID()}`);
    try {
      await this.#must(tip === undefined ? ["read-tree", "--empty"] : ["read-tree", tip], {
        index,
      });

      // One mechanism for both, because a bare repository refuses
      // `update-index --force-remove` as a work-tree operation, and
      // `--index-info` is the spelling that works without one. A null object
      // id removes the entry; anything else stages it.
      const blob =
        content === undefined
          ? "0".repeat(40)
          : (await this.#must(["hash-object", "-w", "--stdin"], { stdin: content }))
              .toString("utf8")
              .trim();
      const mode = content === undefined ? "0" : "100644";
      await this.#must(["update-index", "--index-info"], {
        index,
        stdin: Buffer.from(`${mode} ${blob}\t${path}\n`, "utf8"),
      });

      const tree = (await this.#must(["write-tree"], { index })).toString("utf8").trim();
      const commit = await this.#must([
        "commit-tree",
        tree,
        ...(tip === undefined ? [] : ["-p", tip]),
        "-m",
        message,
      ]);
      return commit.toString("utf8").trim();
    } finally {
      await rm(index, { force: true });
    }
  }

  async read(id: string): Promise<Stored | null> {
    await this.#prepare();
    await this.#fetch();

    const path = this.#path(id);
    const oid = await this.#oid(`${this.#ref}:${path}`);
    if (oid === undefined) return null;

    const raw = (await this.#must(["cat-file", "blob", oid])).toString("utf8");

    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch (cause) {
      throw new StoreUnavailable(`${path} is not JSON`, cause);
    }

    if (!isCanvasRecord(record))
      throw new StoreUnavailable(`${path} is not a canvas record`);

    // The path is the authority on identity; a copied file must not answer for
    // the id it was copied from.
    if (record.id !== id)
      throw new StoreUnavailable(`${path} holds canvas ${record.id}`);

    // The blob's own id, so the write that follows is a compare-and-swap on
    // exactly these bytes. Never persisted, so nothing minds that the GitLab
    // store used to hand back a commit id instead.
    return { record, etag: oid };
  }

  async create(record: CanvasRecord): Promise<WriteResult> {
    return this.#write(
      `canvas ${record.id}: mint`,
      this.#path(record.id),
      serialise(record),
      { kind: "absent" },
    );
  }

  async replace(record: CanvasRecord, etag: string): Promise<WriteResult> {
    return this.#write(
      `canvas ${record.id}: rev ${record.rev}`,
      this.#path(record.id),
      serialise(record),
      { kind: "blob", oid: etag },
    );
  }

  async remove(id: string, etag: string): Promise<WriteResult> {
    return this.#write(`canvas ${id}: delete`, this.#path(id), undefined, {
      kind: "blob",
      oid: etag,
    });
  }

  /**
   * How many canvas files the tree holds — exactly, and from the mirror.
   *
   * Walking a tree locally costs one process and no round trip, so unlike an
   * API that pages there is nothing here to give up on: `atLeast` is always
   * false. A failure answers undefined rather than throwing; a count is
   * decoration, and no request should fail for want of one.
   */
  async count(): Promise<Count | undefined> {
    try {
      await this.#prepare();
      await this.#fetch();

      if ((await this.#oid(`${this.#ref}^{commit}`)) === undefined)
        return { canvases: 0, atLeast: false };

      const { prefix } = this.#settings;
      const out = await this.#must([
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        this.#ref,
        ...(prefix === "" ? [] : ["--", prefix]),
      ]);

      const canvases = out
        .toString("utf8")
        .split("\0")
        .filter((path) => path.endsWith(".json")).length;

      return { canvases, atLeast: false };
    } catch {
      return undefined;
    }
  }

  /** One round trip to the remote, which is also the credential check. */
  async ping(): Promise<void> {
    await this.#prepare();
    const run = await this.#git([
      "ls-remote",
      "--heads",
      "origin",
      this.#settings.branch,
    ]);
    // An empty answer is fine: a repository with no branch yet is reachable,
    // and the first mint is what makes the branch.
    if (run.code !== 0) throw this.#refusal("git ls-remote", run.stderr);
  }
}

/**
 * The record as it sits in the repository: pretty-printed JSON with a trailing
 * newline, which is what the GitLab-API store wrote and therefore what a
 * repository migrated from it already holds.
 */
const serialise = (record: CanvasRecord): Buffer =>
  Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");

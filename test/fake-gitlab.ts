import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

/**
 * Just enough GitLab to test the store against: the two endpoints it uses, the
 * `last_commit_id` rule that makes them a compare-and-swap, and the refusals
 * whose wording the store reads.
 *
 * The wording matters more than it looks. GitLab reports "the blob moved under
 * you" and "another commit reached the branch first" with the same 400, and only
 * the sentence tells them apart — one is a conflict to hand back, the other is
 * worth retrying. So the phrasing here is copied from GitLab, and a test that
 * passes against this fake is testing that reading.
 */

export type FakeGitLab = {
  baseUrl: string;
  /** file path to its current content and last commit. */
  files: Map<string, { content: string; lastCommitId: string }>;
  /** Commits refused with a branch-level conflict before one is allowed. */
  branchCollisions: number;
  /** Requests answered 429 before one is allowed. */
  throttles: number;
  readonly commits: number;
  close: () => Promise<void>;
};

const FILE_CHANGED =
  "You are attempting to update a file that has changed since you started editing it.";
const BRANCH_MOVED = "Could not update refs/heads/main. Please refresh and try again.";
const EXISTS = "A file with this name already exists";

export const startFakeGitLab = async (): Promise<FakeGitLab> => {
  const files = new Map<string, { content: string; lastCommitId: string }>();
  const state = { branchCollisions: 0, throttles: 0, commits: 0 };

  const server: Server = createServer((req, res) => {
    const answer = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        ...(status === 429 ? { "retry-after": "17" } : {}),
      });
      res.end(text);
    };

    if (state.throttles > 0) {
      state.throttles -= 1;
      answer(429, { message: "Too many requests" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const files_ = /^\/api\/v4\/projects\/[^/]+\/repository\/files\/([^/]+)$/.exec(
      url.pathname,
    );
    const commits =
      /^\/api\/v4\/projects\/[^/]+\/repository\/commits$/.test(url.pathname);
    const project = /^\/api\/v4\/projects\/[^/]+$/.test(url.pathname);

    if (project && req.method === "GET") {
      answer(200, { id: 1, path_with_namespace: "group/canvases" });
      return;
    }

    if (files_?.[1] !== undefined && req.method === "GET") {
      const path = decodeURIComponent(files_[1]);
      const held = files.get(path);
      if (held === undefined) {
        answer(404, { message: "404 File Not Found" });
        return;
      }
      answer(200, {
        file_path: path,
        encoding: "base64",
        content: Buffer.from(held.content, "utf8").toString("base64"),
        last_commit_id: held.lastCommitId,
        blob_id: "blob",
      });
      return;
    }

    if (commits && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          actions: {
            action: string;
            file_path: string;
            content?: string;
            encoding?: string;
            last_commit_id?: string;
          }[];
        };

        if (state.branchCollisions > 0) {
          state.branchCollisions -= 1;
          answer(400, { message: BRANCH_MOVED });
          return;
        }

        const action = body.actions[0];
        if (action === undefined) {
          answer(400, { message: "actions is empty" });
          return;
        }

        const held = files.get(action.file_path);

        if (action.action === "create") {
          if (held !== undefined) {
            answer(400, { message: EXISTS });
            return;
          }
        } else {
          if (held === undefined) {
            answer(404, { message: "404 File Not Found" });
            return;
          }
          if (action.last_commit_id !== held.lastCommitId) {
            answer(400, { message: FILE_CHANGED });
            return;
          }
        }

        const commitId = randomBytes(20).toString("hex");
        state.commits += 1;

        if (action.action === "delete") files.delete(action.file_path);
        else
          files.set(action.file_path, {
            content: Buffer.from(
              action.content ?? "",
              action.encoding === "base64" ? "base64" : "utf8",
            ).toString("utf8"),
            lastCommitId: commitId,
          });

        answer(201, { id: commitId, short_id: commitId.slice(0, 8) });
      });
      return;
    }

    answer(404, { message: "404 Not Found" });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    files,
    get branchCollisions() {
      return state.branchCollisions;
    },
    set branchCollisions(value: number) {
      state.branchCollisions = value;
    },
    get throttles() {
      return state.throttles;
    },
    set throttles(value: number) {
      state.throttles = value;
    },
    get commits() {
      return state.commits;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

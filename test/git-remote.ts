import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real git repository, standing in for whatever the operator points at.
 *
 * There is no fake here on purpose. The whole store is `git` invocations, so a
 * test against a simulated git would only prove that the simulation agrees with
 * the code that was written against it — and the interesting behaviour, a push
 * refused because somebody else moved the branch, is exactly the part a fake
 * gets wrong. A bare repository in a temporary directory is a remote in every
 * way that matters, and pushing to one takes the same refusals.
 */
export type Remote = {
  /** What `GIT_REMOTE` would be set to. */
  url: string;
  /** A directory the test owns, for the mirrors it points stores at. */
  scratch: string;
  /** Every path the branch holds, sorted. */
  files: () => Promise<string[]>;
  /** The blob at a path, or undefined when the branch does not hold one. */
  read: (path: string) => Promise<string | undefined>;
  /** Commit subjects, newest first. */
  log: () => Promise<string[]>;
  /** Commit a file the way anything else writing this repository would. */
  seed: (path: string, content: string, message: string) => Promise<void>;
  /** Refuse every push, saying this. Undefined removes the refusal. */
  refuse: (message: string | undefined) => Promise<void>;
  close: () => Promise<void>;
};

const BRANCH = "main";

const run = (
  args: string[],
  env: Record<string, string> = {},
  stdin?: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      { env: { ...process.env, ...env }, maxBuffer: 16_000_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args.join(" ")}: ${stderr}`));
        else resolve(stdout);
      },
    );
    child.stdin?.end(stdin);
  });

export const startRemote = async (): Promise<Remote> => {
  const root = await mkdtemp(join(tmpdir(), "pr-lens-git-"));
  const url = join(root, "remote.git");
  const hook = join(url, "hooks", "pre-receive");

  await run(["init", "--bare", "--quiet", `--initial-branch=${BRANCH}`, url]);

  const git = (...args: string[]): Promise<string> =>
    run(args, { GIT_DIR: url });

  const held = async (path: string): Promise<string | undefined> => {
    try {
      return await git("cat-file", "blob", `${BRANCH}:${path}`);
    } catch {
      return undefined;
    }
  };

  return {
    url,
    scratch: root,
    files: async () => {
      try {
        const out = await git("ls-tree", "-r", "--name-only", BRANCH);
        return out.split("\n").filter((line) => line !== "").sort();
      } catch {
        // No branch yet: nothing has ever been written.
        return [];
      }
    },
    read: held,
    log: async () => {
      try {
        const out = await git("log", "--format=%s", BRANCH);
        return out.split("\n").filter((line) => line !== "");
      } catch {
        return [];
      }
    },
    seed: async (path, content, message) => {
      const index = join(root, `seed-index-${path.replace(/\W/g, "")}`);
      const env = { GIT_DIR: url, GIT_INDEX_FILE: index };
      const parent = await run(
        ["rev-parse", "--verify", "--quiet", BRANCH],
        env,
      ).catch(() => "");
      await run(
        parent === "" ? ["read-tree", "--empty"] : ["read-tree", parent.trim()],
        env,
      );
      const blob = (
        await run(["hash-object", "-w", "--stdin"], env, content)
      ).trim();
      await run(
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`],
        env,
      );
      const tree = (await run(["write-tree"], env)).trim();
      const commit = (
        await run(
          parent === ""
            ? ["commit-tree", tree, "-m", message]
            : ["commit-tree", tree, "-p", parent.trim(), "-m", message],
          {
            ...env,
            GIT_AUTHOR_NAME: "seed",
            GIT_AUTHOR_EMAIL: "seed@localhost",
            GIT_COMMITTER_NAME: "seed",
            GIT_COMMITTER_EMAIL: "seed@localhost",
          },
        )
      ).trim();
      await run(["update-ref", `refs/heads/${BRANCH}`, commit], env);
      await rm(index, { force: true });
    },
    refuse: async (message) => {
      if (message === undefined) {
        await rm(hook, { force: true });
        return;
      }
      await writeFile(hook, `#!/bin/sh\necho "${message}" >&2\nexit 1\n`);
      await chmod(hook, 0o755);
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
};

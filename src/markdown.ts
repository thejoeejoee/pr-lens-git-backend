import { readFile, stat } from "node:fs/promises";

import { marked } from "marked";
import type { Facts } from "./page.ts";
import { VERSION } from "./version.ts";

/**
 * The operator's own index page, written in Markdown and mounted into the
 * container.
 *
 * The page at `/` is this server's idea of what a stranger needs to know, which
 * is not always the right one: a team running this internally would rather say
 * which GitLab project is behind it, who to ask, and which of their own commands
 * to run. `INDEX_MARKDOWN_FILE` points at a file, and that file becomes the page.
 *
 * A file rather than a setting, because the natural home for a page of prose in
 * Kubernetes is a ConfigMap, and a ConfigMap arrives as a mounted file. Which
 * also means it can be edited without a rollout: the file is re-read whenever it
 * changes on disk, so `kubectl edit configmap` is the whole deployment.
 *
 * What the file may contain is GitHub-flavoured Markdown — and raw HTML, which
 * `marked` passes through untouched. That is a deliberate consequence of where
 * the file comes from: whoever can mount it can already set `GITLAB_TOKEN`, so
 * there is nothing here for an escaping rule to protect. It does mean a stray
 * `<script>` in that file runs on this origin, like any other thing an operator
 * puts in their own page.
 */

/** Placeholders the page may use, since the operator writing it knows none of them. */
const substitute = (
  markdown: string,
  origin: string,
  facts: Facts,
): string => {
  const values: Record<string, string> = {
    origin,
    version: VERSION,
    store: facts.store,
    canvases: countText(facts.count),
    diagrams: facts.draws ? "drawn on push" : "not drawn",
  };
  // Substituted before rendering rather than after, so a placeholder inside a
  // code fence is escaped by the renderer like any other text in it.
  return markdown.replace(
    /\{\{\s*([a-z]+)\s*\}\}/g,
    (whole, name: string) => values[name] ?? whole,
  );
};

const countText = (count: Facts["count"]): string => {
  if (count === undefined) return "—";
  if (count.canvases === 0) return "none yet";
  return `${count.atLeast ? "at least " : ""}${count.canvases.toLocaleString("en-GB")}`;
};

/**
 * The `<title>`, which Markdown has no way to state outright: the first heading
 * of the document, with its inline markup taken back off.
 */
const titleOf = (markdown: string): string | undefined => {
  const heading = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(markdown)?.[1];
  if (heading === undefined) return undefined;
  const plain = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
  return plain === "" ? undefined : plain;
};

export type CustomIndex = {
  /** Throws if the file cannot be read, which at startup is a refusal to start. */
  warm: () => Promise<void>;
  page: (origin: string, facts: Facts) => Promise<{ title: string; body: string }>;
};

/**
 * A reader for that file, holding the last copy it managed to read.
 *
 * `stat` before `readFile` is one syscall to decide whether the other is worth
 * doing, so the common case — a file nobody has touched since the last request —
 * costs a stat and a parse rather than a disk read. Kubernetes swaps a ConfigMap
 * in by moving a symlink, so the change shows up as a new mtime and the page
 * follows it on the next request.
 *
 * A file that has gone missing is served from the last good copy instead. An
 * index page is not worth a 500, and a ConfigMap being replaced badly should not
 * take the pages down with it.
 */
export const customIndex = (file: string): CustomIndex => {
  let held: { key: string; markdown: string } | undefined;
  let complained = false;

  const source = async (): Promise<string> => {
    try {
      const { mtimeMs, size } = await stat(file);
      const key = `${mtimeMs}:${size}`;
      if (held?.key !== key)
        held = { key, markdown: await readFile(file, "utf8") };
      complained = false;
      return held.markdown;
    } catch (error: unknown) {
      if (held === undefined) throw error;
      if (!complained) {
        complained = true;
        console.error(
          `[pr-lens-gitlab-backend] ${file} could not be read, serving the last copy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return held.markdown;
    }
  };

  return {
    warm: async () => void (await source()),
    page: async (origin, facts) => {
      const markdown = substitute(await source(), origin, facts);
      return {
        title: titleOf(markdown) ?? "PR Lens canvas server",
        body: marked.parse(markdown, { async: false, gfm: true }),
      };
    },
  };
};

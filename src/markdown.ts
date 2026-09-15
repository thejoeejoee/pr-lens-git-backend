import { readFile, stat } from "node:fs/promises";

import { Marked } from "marked";
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
 * What the file may contain is GitHub-flavoured Markdown, and raw HTML for the
 * things Markdown has no syntax for — but nothing that executes. Scripts are
 * dropped here and could not run anyway: the page is served under a
 * Content-Security-Policy that admits only this server's own script, by nonce.
 *
 * Belt and braces on purpose. A page that is one `kubectl edit` away from
 * anybody with access to the namespace is a tempting place to put a beacon or a
 * token-grabber in, and "the operator could have set GITLAB_TOKEN anyway" is an
 * argument about the operator, not about whoever ends up editing that ConfigMap.
 */

/**
 * Raw HTML from the file, with everything that can execute taken out.
 *
 * This is not a general-purpose sanitiser and does not try to be one — the
 * Content-Security-Policy is what actually guarantees nothing runs. What this
 * does is make the page say so honestly: a `<script>` in the file is gone rather
 * than present and silently refused, which is what somebody reading their own
 * page would expect to see.
 *
 * Only the raw-HTML tokens pass through here. Everything the renderer generates
 * itself is untouched, so there is no chance of mangling a table or a code fence
 * on the way past.
 */
const EXECUTES = "script|iframe|frame|frameset|object|embed|applet|base|meta|link|form";

const sanitize = (html: string): string =>
  html
    // The element and its contents, so the body of a <script> does not survive
    // as visible text on the page.
    .replace(
      new RegExp(`<(${EXECUTES})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi"),
      "",
    )
    // A lone tag of the same kind: void elements, and either half of a pair that
    // arrived as its own inline token.
    .replace(new RegExp(`<\\/?(?:${EXECUTES})\\b[^>]*>`, "gi"), "")
    // onclick, onerror, onload and the rest of them.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // javascript: in anything that navigates. A data: URL stays: it is how an
    // image gets inlined, and a data: document cannot reach this origin.
    .replace(
      /\s(href|src|xlink:href|action|formaction)\s*=\s*(?:"\s*(?:java|vb)script:[^"]*"|'\s*(?:java|vb)script:[^']*'|\s*(?:java|vb)script:[^\s>]*)/gi,
      "",
    );

/** The same rule for a link Markdown wrote itself, which never passes through sanitize. */
const safeHref = (href: string): string =>
  /^\s*(?:java|vb)script:/i.test(href) ? "" : href;

/**
 * One renderer, built once. `marked` is stateful per instance, so this is an
 * instance rather than the module-level singleton every other importer shares.
 */
const renderer = new Marked({ gfm: true }).use({
  renderer: {
    html: ({ text }: { text: string }) => sanitize(text),
    link({ href, title, tokens }) {
      const safe = safeHref(href);
      const text = this.parser.parseInline(tokens);
      if (safe === "") return text;
      return `<a href="${safe}"${title === null || title === undefined ? "" : ` title="${title}"`}>${text}</a>`;
    },
    image({ href, title, text }) {
      const safe = safeHref(href);
      if (safe === "") return text;
      return `<img src="${safe}" alt="${text}"${title === null || title === undefined ? "" : ` title="${title}"`}>`;
    },
  },
});

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
        body: renderer.parse(markdown, { async: false }),
      };
    },
  };
};

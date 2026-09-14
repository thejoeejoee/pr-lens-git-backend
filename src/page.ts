import type { Canvas } from "./canvas.ts";
import { imageUrl } from "./urls.ts";
import { VERSION } from "./version.ts";

/**
 * The three pages this server serves: `/`, `/c/{id}` and `/c/{id}.svg`.
 *
 * The contract says nothing about any of them. It only asks that the canvas page
 * sit at `/c/{id}`, so that a link pasted into `pr-lens canvas pull` is
 * recognised and its origin taken as the API. Everything below that is this
 * server's own idea of what to show, and deliberately a small one — no scripts,
 * no fonts, no requests off this origin for anything that renders.
 *
 * The write token never reaches here. It travels in the URL fragment, which the
 * browser sends to no server, so nothing on these pages can leak it.
 */

const escape = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );

/**
 * One stylesheet, inline, for both pages. Inline because a second request for a
 * stylesheet is a second thing to cache, invalidate and get wrong, and this is
 * two kilobytes.
 */
const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escape(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --ink: #1b1b1f;
  --dim: #63636b;
  --page: #fbfbfd;
  --card: #ffffff;
  --edge: #e4e4ea;
  --accent: #6d4aff;
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #ececf1; --dim: #9a9aa5; --page: #14141a; --card: #1c1c24; --edge: #2c2c37; --accent: #a894ff; }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 3rem 1.25rem 5rem;
  background: var(--page);
  color: var(--ink);
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .4rem; letter-spacing: -.01em; }
h2 { font-size: 1rem; margin: 0; letter-spacing: -.005em; }
a { color: var(--accent); }
.lede { color: var(--dim); margin: 0 0 .5rem; max-width: 62ch; }
.rev { color: var(--dim); font-size: .8rem; margin: 0 0 2.5rem; font-variant-numeric: tabular-nums; }
figure { margin: 0 0 2.5rem; }
figcaption { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; margin-bottom: .6rem; }
.meta { color: var(--dim); font-size: .8rem; margin: 0; }
picture { display: block; }
img {
  display: block; width: 100%; height: auto;
  background: var(--card);
  border: 1px solid var(--edge);
  border-radius: 10px;
}
.empty { color: var(--dim); }

/* The index page */
.narrow { max-width: 70ch; }
h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 2.5rem 0 .75rem; }
pre {
  background: var(--card); border: 1px solid var(--edge); border-radius: 10px;
  padding: .9rem 1rem; overflow-x: auto; margin: 0 0 1rem;
  font: .875rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
ul { padding-left: 1.1rem; margin: 0 0 1rem; }
li { margin-bottom: .35rem; }
dl { display: grid; grid-template-columns: auto 1fr; gap: .35rem 1rem; margin: 0; font-size: .9rem; }
dt { color: var(--dim); }
dd { margin: 0; font-variant-numeric: tabular-nums; }
footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--edge); color: var(--dim); font-size: .85rem; }
.warn { border-left: 2px solid var(--accent); padding-left: .9rem; color: var(--dim); }
</style>
</head>
<body>
${body}
</body>
</html>
`;

/** The tile the embed shows, which the contract fixes as the first one. */
export const heroOf = (canvas: Canvas) =>
  canvas.drawing.tiles.find((tile) => tile.hero) ?? canvas.drawing.tiles[0];

export const heroSvg = (
  canvas: Canvas,
  theme: "light" | "dark",
): { svg: string; contentHash: string } | undefined => {
  const hero = heroOf(canvas);
  if (hero === undefined) return undefined;

  const fileName = hero.files[theme] ?? hero.files.light;
  const contentHash = hero.renders[theme] ?? hero.renders.light;
  if (fileName === undefined || contentHash === undefined) return undefined;

  const svg = canvas.drawing.images.get(fileName);
  return svg === undefined ? undefined : { svg, contentHash };
};

/**
 * A `<picture>` per tile: the dark render behind a media query, the light one as
 * the fallback. Which means the page follows the reader's theme with no
 * stylesheet trickery and no script at all.
 */
const tileFigure = (
  origin: string,
  id: string,
  tile: Canvas["drawing"]["tiles"][number],
): string => {
  const light = tile.files.light;
  const dark = tile.files.dark;
  if (light === undefined) return "";

  const trail = tile.crumbs.length > 1 ? tile.crumbs.join(" / ") : "";

  return `<figure>
  <figcaption>
    <h2>${escape(tile.title)}</h2>
    <p class="meta">${escape(tile.lens)}${trail === "" ? "" : ` &middot; ${escape(trail)}`}</p>
  </figcaption>
  <picture>
    ${dark === undefined ? "" : `<source srcset="${escape(imageUrl(origin, id, dark))}" media="(prefers-color-scheme: dark)">`}
    <img src="${escape(imageUrl(origin, id, light))}" width="${tile.width}" height="${tile.height}" alt="${escape(tile.title)}" loading="lazy">
  </picture>
</figure>`;
};

export const canvasPage = (origin: string, canvas: Canvas): string => {
  const title = canvas.document?.title ?? canvas.id;
  const summary = canvas.document?.summary;
  const tiles = canvas.drawing.tiles;

  const body =
    tiles.length === 0
      ? `<p class="empty">This canvas holds a document but no pictures were drawn from it${
          canvas.document === undefined
            ? ", because this server cannot read its schema version"
            : ""
        }.</p>`
      : tiles.map((tile) => tileFigure(origin, canvas.id, tile)).join("\n");

  return shell(
    title,
    `<main>
<h1>${escape(title)}</h1>
${summary === undefined ? "" : `<p class="lede">${escape(summary)}</p>`}
<p class="rev">Revision ${canvas.rev} &middot; ${tiles.length} diagram${tiles.length === 1 ? "" : "s"}</p>
${body}
</main>`,
  );
};

/** What the index page is allowed to say about the server behind it. */
export type Facts = {
  /** "gitlab" or "memory" — which is the difference between kept and forgotten. */
  store: string;
  /** False means every answer carries `tiles: []`. */
  draws: boolean;
};

/**
 * `GET /`, for the person who pasted the host into a browser to find out what it
 * is.
 *
 * It answers three questions and stops: what this is, how to point the CLI at
 * it, and what happens to what they push. Deliberately absent is anything about
 * the deployment — no GitLab host, no project, no token hint, no canvas count,
 * and above all no ids, since an id is a read capability. Which store kind and
 * whether it draws are the exceptions, because both change what a user should
 * expect: `memory` forgets on restart, and a server that does not draw reports
 * "0 diagrams" without anything being wrong.
 */
export const indexPage = (origin: string, facts: Facts): string =>
  shell(
    "PR Lens canvas server",
    `<main class="narrow">
<h1>PR Lens canvas server</h1>
<p class="lede">This host keeps <a href="https://github.com/coldteadotai/pr-lens">PR Lens</a>
canvases: a diagram of a change, pushed from the CLI, kept as a document and
served back as pictures. It speaks version 1 of the canvas API, so nothing you
push here is sent to prlens.dev.</p>

<h3>Point the CLI at it</h3>
<pre><code>export PR_LENS_API_URL=${escape(origin)}
pr-lens canvas push</code></pre>
<p>The CLI prints two links: a view link anyone can open, and an edit link that
carries your write token. Both are also recorded in <code>.pr-lens/canvas.json</code>
in your repository.</p>

<h3>What it does with a canvas</h3>
<ul>
<li><strong>Mints</strong> it, handing out a read id and a write token &mdash; 128 random bits each.</li>
<li><strong>Keeps</strong> a revision per push. A push that lands on a revision somebody else already took is refused rather than merged, so nothing is ever silently overwritten.</li>
<li><strong>Draws</strong> it, and serves each picture from an address containing that picture's own hash, so a diagram can be cached for ever and a changed one is simply a different URL.</li>
</ul>

<h3>Links are the permission</h3>
<p class="warn">There are no accounts here. Anyone holding a canvas's view link
can read it, and anyone holding the write token can overwrite or delete it. The
token rides in the link's <code>#fragment</code>, which a browser never sends to
a server &mdash; so share view links freely and edit links carefully.</p>

<h3>This server</h3>
<dl>
<dt>Canvas API</dt><dd>version 1</dd>
<dt>Version</dt><dd>${escape(VERSION)}</dd>
<dt>Store</dt><dd>${escape(facts.store)}${facts.store === "memory" ? " &mdash; forgets every canvas when this process restarts" : ""}</dd>
<dt>Diagrams</dt><dd>${facts.draws ? "drawn on push" : "not drawn; every answer reports 0 diagrams"}</dd>
</dl>

<footer>
<a href="https://github.com/thejoeejoee/pr-lens-gitlab-backend">pr-lens-gitlab-backend</a>
&middot; <a href="https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md">the canvas API</a>
&middot; <a href="/healthz">healthz</a>
</footer>
</main>`,
  );

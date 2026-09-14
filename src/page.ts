import type { Canvas } from "./canvas.ts";
import { imageUrl } from "./urls.ts";

/**
 * What `/c/{id}` and `/c/{id}.svg` serve.
 *
 * The contract says nothing about either: it only asks that the canvas page sit
 * at `/c/{id}`, so that a link pasted into `pr-lens canvas pull` is recognised
 * and its origin taken as the API. Everything below that is this server's own
 * idea of what to show, and deliberately a small one — no scripts, no fonts, no
 * requests off this origin, and the pictures arriving as plain images from the
 * content-addressed routes rather than inlined into the page.
 *
 * The write token never reaches here. It travels in the URL fragment, which the
 * browser sends to no server, so nothing on this page can leak it.
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
const tileFigure = (origin: string, id: string, tile: Canvas["drawing"]["tiles"][number]): string => {
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

  return `<!doctype html>
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
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #ececf1; --dim: #9a9aa5; --page: #14141a; --card: #1c1c24; --edge: #2c2c37; }
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
</style>
</head>
<body>
<main>
<h1>${escape(title)}</h1>
${summary === undefined ? "" : `<p class="lede">${escape(summary)}</p>`}
<p class="rev">Revision ${canvas.rev} &middot; ${tiles.length} diagram${tiles.length === 1 ? "" : "s"}</p>
${body}
</main>
</body>
</html>
`;
};

import type { Canvas } from "./canvas.ts";
import { imageUrl } from "./urls.ts";
import { VERSION } from "./version.ts";

/**
 * The three pages this server serves: `/`, `/c/{id}` and `/c/{id}.svg`.
 *
 * The contract says nothing about any of them. It only asks that the canvas page
 * sit at `/c/{id}`, so that a link pasted into `pr-lens canvas pull` is
 * recognised and its origin taken as the API. Everything below that is this
 * server's own idea of what to show, and deliberately a small one — no fonts, no
 * requests off this origin for anything these pages render, and the one script
 * inline and doing one thing: remembering which theme the reader picked. A page
 * an operator mounted is their own on that last point: it may name pictures
 * wherever it likes, which is why it is served under a policy of its own.
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

/** Where the reader's choice is kept, and the three things it may say. */
const THEME_KEY = "pr-lens-theme";

/**
 * The switcher, top right of every page. A radio group rather than three
 * buttons, because that is what it is: one of three, always exactly one.
 *
 * "Auto" is the absence of a choice, not a fourth colour — it hands the page
 * back to `prefers-color-scheme`, which is where it started.
 *
 * A radio group is one tab stop with arrow keys inside it, so the checked button
 * carries the only `tabindex="0"` and the script moves it along with the choice.
 */
const THEMES = `<div class="themes" role="radiogroup" aria-label="Colour theme">
  <button type="button" role="radio" aria-checked="false" tabindex="-1" data-theme-choice="light">Light</button>
  <button type="button" role="radio" aria-checked="false" tabindex="-1" data-theme-choice="dark">Dark</button>
  <button type="button" role="radio" aria-checked="true" tabindex="0" data-theme-choice="auto">Auto</button>
</div>`;

/**
 * Inline in `<head>`, so the attribute is on `<html>` before the first paint and
 * a reader who chose dark never sees a white page flash past.
 *
 * `localStorage` is read inside a `try`: a browser set to refuse storage throws
 * on the read itself, and the page is meant to work there too, just forgetfully.
 */
const THEME_BOOT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;
}catch(e){}
document.documentElement.dataset.js="";})();`;

/**
 * At the end of `<body>`, where the control and the pictures exist.
 *
 * The pictures are the part a stylesheet cannot reach: a `<source media>` is
 * matched against the browser's own `prefers-color-scheme`, which a chosen theme
 * does not change. So the choice is written into the media query itself —
 * `all` to force the dark render, `not all` to rule it out, and the original
 * query back again for auto. Rewriting `media` makes the browser re-pick the
 * source, so one render is fetched, not both.
 *
 * Only the sources this server wrote, which is what `data-theme-dark` marks. A
 * mounted index page may hold pictures of the operator's own, with art-direction
 * queries that mean something else entirely, and rewriting those would be this
 * script editing somebody else's page.
 */
const THEME_WIRING = `(function(){
var root=document.documentElement;
var key=${JSON.stringify(THEME_KEY)};
var buttons=document.querySelectorAll("[data-theme-choice]");
function apply(choice){
  if(choice==="light"||choice==="dark")root.dataset.theme=choice;else delete root.dataset.theme;
  var media=choice==="dark"?"all":choice==="light"?"not all":"(prefers-color-scheme: dark)";
  var sources=document.querySelectorAll("source[data-theme-dark]");
  for(var i=0;i<sources.length;i++)sources[i].media=media;
  for(var j=0;j<buttons.length;j++){
    var on=buttons[j].dataset.themeChoice===choice;
    buttons[j].setAttribute("aria-checked",String(on));
    buttons[j].tabIndex=on?0:-1;
  }
}
var saved;try{saved=localStorage.getItem(key);}catch(e){}
var current=saved==="light"||saved==="dark"?saved:"auto";
apply(current);
for(var k=0;k<buttons.length;k++)buttons[k].addEventListener("click",function(){
  current=this.dataset.themeChoice;
  apply(current);
  try{current==="auto"?localStorage.removeItem(key):localStorage.setItem(key,current);}catch(e){}
});
var group=document.querySelector(".themes");
if(group)group.addEventListener("keydown",function(event){
  var step=event.key==="ArrowRight"||event.key==="ArrowDown"?1:
    event.key==="ArrowLeft"||event.key==="ArrowUp"?-1:0;
  var at=Array.prototype.indexOf.call(buttons,document.activeElement);
  if(step===0||at<0)return;
  event.preventDefault();
  var next=buttons[(at+step+buttons.length)%buttons.length];
  next.focus();
  next.click();
});
})();`;

/**
 * One stylesheet, inline, for both pages. Inline because a second request for a
 * stylesheet is a second thing to cache, invalidate and get wrong, and this is
 * two kilobytes.
 */
const shell = (title: string, body: string, nonce: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escape(title)}</title>
<style>
/*
 * Light is the plain reading of :root; dark arrives twice, once for the reader
 * who never touched the switcher and once for the one who chose it. Neither
 * colour is only ever defined inside a query, so a token always has a value.
 */
:root {
  color-scheme: light dark;
  --ink: #1b1b1f;
  --dim: #63636b;
  --page: #fbfbfd;
  --card: #ffffff;
  --edge: #e4e4ea;
  --accent: #6d4aff;
  /* Text on the accent, which is dark once the accent itself is a pale one. */
  --on-accent: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --ink: #ececf1; --dim: #9a9aa5; --page: #14141a; --card: #1c1c24; --edge: #2c2c37; --accent: #a894ff; --on-accent: #14141a; }
}
:root[data-theme="dark"] { --ink: #ececf1; --dim: #9a9aa5; --page: #14141a; --card: #1c1c24; --edge: #2c2c37; --accent: #a894ff; --on-accent: #14141a; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
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

/*
 * Markdown brings elements the pages written by hand never use. h3 is a section
 * label above, which is wrong for a heading somebody wrote as ###, so inside
 * prose the headings are plain headings again.
 */
.prose h2 { font-size: 1.3rem; margin: 2.25rem 0 .6rem; letter-spacing: -.01em; }
.prose h3 { font-size: 1.05rem; text-transform: none; letter-spacing: -.005em; color: var(--ink); margin: 1.75rem 0 .5rem; }
.prose h4, .prose h5, .prose h6 { font-size: .95rem; margin: 1.5rem 0 .4rem; }
.prose p, .prose ul, .prose ol { margin: 0 0 1rem; }
.prose ol { padding-left: 1.1rem; }
.prose blockquote {
  margin: 0 0 1rem; border-left: 2px solid var(--accent);
  padding-left: .9rem; color: var(--dim);
}
.prose hr { border: 0; border-top: 1px solid var(--edge); margin: 2rem 0; }
.prose table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; font-size: .9rem; display: block; overflow-x: auto; }
.prose th, .prose td { border: 1px solid var(--edge); padding: .4rem .6rem; text-align: left; }
.prose th { color: var(--dim); font-weight: 600; }
.prose img { margin: 0 0 1rem; }
.prose :is(h1, h2, h3, h4, h5, h6):first-child { margin-top: 0; }

/*
 * The switcher. Hidden until the script says it is alive, because a control that
 * cannot remember anything is worse than no control at all.
 */
.themes { display: none; }
:root[data-js] .themes {
  display: flex;
  position: fixed;
  top: .9rem;
  right: .9rem;
  z-index: 1;
  gap: .125rem;
  padding: .1875rem;
  background: var(--card);
  border: 1px solid var(--edge);
  border-radius: 999px;
}
.themes button {
  appearance: none;
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--dim);
  padding: .3rem .7rem;
  border-radius: 999px;
  font: inherit;
  font-size: .8rem;
  line-height: 1.2;
}
.themes button:hover { color: var(--ink); }
.themes button[aria-checked="true"] { background: var(--accent); color: var(--on-accent); }
.themes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 30rem) {
  :root[data-js] .themes { top: .5rem; right: .5rem; }
  .themes button { padding: .3rem .55rem; font-size: .75rem; }
}
</style>
<script nonce="${nonce}">${THEME_BOOT}</script>
</head>
<body>
${THEMES}
${body}
<script nonce="${nonce}">${THEME_WIRING}</script>
</body>
</html>
`;

/**
 * What the page is allowed to do, which is: show itself.
 *
 * The scripts this server writes are named by a nonce, and nothing else may run
 * — not an inline `<script>` that reached the page some other way, not an
 * `onclick=`, not a `javascript:` link. That is the guarantee behind letting an
 * operator write raw HTML into their own index page: their HTML is theirs, but
 * it is not code.
 *
 * `images` is the one thing that differs between the two kinds of page. A page
 * this server wrote shows pictures from this server; a page an operator wrote
 * may well point at their intranet's logo, and breaking that to no purpose would
 * be a policy about nothing. Styles stay `unsafe-inline`, since that is what an
 * inline `style=` attribute needs and a stylesheet cannot execute anything.
 */
export const pageCsp = (nonce: string, images: "self" | "anywhere"): string =>
  [
    "default-src 'none'",
    images === "self" ? "img-src 'self'" : "img-src * data:",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

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
 * the fallback. Which means the page follows the reader's system theme on its
 * own, and the switcher only has to edit that one media query to override it.
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
    ${dark === undefined ? "" : `<source srcset="${escape(imageUrl(origin, id, dark))}" media="(prefers-color-scheme: dark)" data-theme-dark>`}
    <img src="${escape(imageUrl(origin, id, light))}" width="${tile.width}" height="${tile.height}" alt="${escape(tile.title)}" loading="lazy">
  </picture>
</figure>`;
};

export const canvasPage = (
  origin: string,
  canvas: Canvas,
  nonce: string,
): string => {
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
    nonce,
  );
};

/** What the index page says about the server behind it. */
export type Facts = {
  /** "gitlab" or "memory" — which is the difference between kept and forgotten. */
  store: string;
  /** False means every answer carries `tiles: []`. */
  draws: boolean;
  /** How many canvases are held. Undefined when the store could not say. */
  count: { canvases: number; atLeast: boolean } | undefined;
};

/**
 * `GET /`, for the person who pasted the host into a browser to find out what it
 * is.
 *
 * Most of the page is one worked example, because the useful thing to know is not
 * that a canvas server exists but how to make a working setup point at this one:
 * the PR Lens skill and the CLI both default to prlens.dev, and one environment
 * variable is what redirects them here.
 *
 * No canvas id appears, since an id is a read capability. Everything else about
 * the server is fair game.
 */
export const indexPage = (
  origin: string,
  facts: Facts,
  nonce: string,
): string =>
  shell(
    "PR Lens canvas server",
    `<main class="narrow">
<h1>PR Lens canvas server</h1>
<p class="lede">This host keeps <a href="https://github.com/coldteadotai/pr-lens">PR Lens</a>
canvases: a diagram of a change, pushed from your machine, kept as a document and
served back as pictures. It speaks version 1 of the canvas API, so nothing you
push here is sent to prlens.dev.</p>

<h3>Send your diagrams here instead of prlens.dev</h3>
<p>The CLI and the PR Lens agent skill both default to prlens.dev. One variable
redirects them at this host &mdash; put it in your shell profile and forget it:</p>
<pre><code>export PR_LENS_API_URL=${escape(origin)}</code></pre>
<p>Or per command, without exporting anything:
<code>--api ${escape(origin)}</code>.</p>

<h3>With the agent skill</h3>
<p>With that variable set, ask for a diagram the way you normally would:</p>
<pre><code>$ claude "diagram this PR with pr-lens"</code></pre>
<p>The skill reads the diff, writes <code>.pr-lens/graph.json</code>, then runs
these three. The last one lands the canvas here:</p>
<pre><code>$ npx @coldtea/pr-lens-cli@latest validate .pr-lens/graph.json
$ npx @coldtea/pr-lens-cli@latest render .pr-lens/graph.json --theme light
$ npx @coldtea/pr-lens-cli@latest canvas push

✓ ${escape(origin)}/c/Qk3vZp9xLm2aRt8yWn4bCg &mdash; rev 1 &middot; 4 diagrams
  unlisted: anyone you share it with can open it, no sign-in needed
  README embed: ${escape(origin)}/c/Qk3vZp9xLm2aRt8yWn4bCg.svg
  remove: pr-lens canvas delete</code></pre>
<p>The skill's own instructions say that link will be
<code>prlens.dev/c/{id}</code>. It will not; it will be this host. A prlens.dev
link means the variable did not reach the CLI.</p>

<h3>Pushing again</h3>
<p>The same canvas, updated in place. The link does not change, so one you have
already shared keeps working:</p>
<pre><code>$ claude "add the retry queue to that diagram"

✓ ${escape(origin)}/c/Qk3vZp9xLm2aRt8yWn4bCg &mdash; rev 2 &middot; 4 diagrams</code></pre>
<p>Notice that the push printed no write token. It is saved in
<code>.pr-lens/canvas.json</code> alongside this host's address, and the CLI keeps
that file out of git. To take over a canvas on another machine, hand it the edit
link instead:</p>
<pre><code>npx @coldtea/pr-lens-cli@latest canvas pull '${escape(origin)}/c/{id}#w={token}'</code></pre>

<h3>Embedding one in a README</h3>
<pre><code>![Architecture after this change](${escape(origin)}/c/{id}.svg)</code></pre>
<p>That is the <code>README embed</code> line above. It serves the top view and
follows the canvas, so the picture updates when you push. Each individual render also has an address of its own containing
its content hash, which never changes and may be cached for ever.</p>

<h3>Links are the permission</h3>
<p class="warn">There are no accounts here. Anyone holding a view link can read
that canvas, and anyone holding the write token can overwrite or delete it. The
token rides in the link's <code>#fragment</code>, which a browser never sends to a
server &mdash; so share view links freely and edit links carefully.</p>

<h3>This server</h3>
<dl>
<dt>Canvas API</dt><dd>version 1</dd>
<dt>Version</dt><dd>${escape(VERSION)}</dd>
<dt>Canvases</dt><dd>${countText(facts.count)}</dd>
<dt>Store</dt><dd>${escape(facts.store)}${facts.store === "memory" ? " &mdash; forgets every canvas when this process restarts" : ""}</dd>
<dt>Diagrams</dt><dd>${facts.draws ? "drawn on push" : "not drawn; every answer reports 0 diagrams"}</dd>
</dl>

<footer>
<a href="https://github.com/thejoeejoee/pr-lens-gitlab-backend">pr-lens-gitlab-backend</a>
&middot; <a href="https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md">the canvas API</a>
&middot; <a href="/healthz">healthz</a>
</footer>
</main>`,
    nonce,
  );

/**
 * The operator's own page, in the same shell as every other: their Markdown,
 * rendered elsewhere, dropped where the default body would have gone.
 *
 * Which means their page gets the stylesheet, the theme switcher and the reader's
 * remembered choice for free, and they write only the words.
 */
export const markdownPage = (
  title: string,
  body: string,
  nonce: string,
): string => shell(title, `<main class="narrow prose">\n${body}</main>`, nonce);

const countText = (count: Facts["count"]): string => {
  if (count === undefined) return "&mdash;";
  if (count.canvases === 0) return "none yet";
  return `${count.atLeast ? "at least " : ""}${count.canvases.toLocaleString("en-GB")}`;
};

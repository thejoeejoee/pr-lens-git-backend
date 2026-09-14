# Determinism and caching

This server stores documents and no pictures. Every SVG it serves is drawn on
demand from the document it came from. That sounds like the expensive choice and
is in fact the reason the whole thing is simple.

## The property it rests on

`@coldtea/pr-lens-renderer` reads no clock, no file and no random number. The
same document and options produce the same bytes, on any machine, in any order —
the renderer's own documentation says so, because that is what lets a render be
addressed by its own hash.

Three things follow.

**There is no second place to put bytes.** No object store, no volume, no
lifecycle policy, nothing to back up beside the repository. A canvas is a
document; everything else is a function of it.

**Any replica can serve any picture.** A pod that holds the document can draw
every picture of it, so no shared cache is needed and a new pod is warm as soon
as it can read the store.

**A picture's hash is its name.** `overview-light-1fba2ea0….svg` cannot change
its contents, because different contents would be a different name. So it is
served `immutable` with a year's lifetime, and a changed diagram arrives as a new
URL rather than as new bytes at the old one — which is exactly what GitHub's
image proxy needs to show an updated diagram in a pull request comment.

Cost is bounded by an LRU of rendered bytes (`RENDER_CACHE_BYTES`), keyed by the
document's own hash. A push draws once and warms it; a fetch of the same revision
is then free.

## Why the API stays no-store

The contract asks for `Cache-Control: no-store` on its answers, "so that nothing
between the CLI and the server keeps a document under an address that is meant to
stay secret". This server obeys that on every API route and on `/c/{id}`, which
carries the document's title and summary.

The pictures opt out on purpose, and the reasoning is worth being explicit about:
a canvas id **is** the read capability. Anyone holding
`/images/{id}/…` is already authorised to see it, so a shared cache keyed on that
URL grants nothing that the URL did not already grant. What it does mean is that
CDN access logs become a list of live canvas ids — see
[put a CDN in front](../how-to/put-a-cdn-in-front.md). This server redacts ids
from its own logs for the same reason.

`/c/{id}.svg` sits between the two: it is the embed address, so it must not
change when the picture does, and it is therefore revalidated against the
render's hash as an ETag rather than frozen.

## The trade you are making

Drawing on demand spends CPU where storing pictures would spend storage and
invalidation logic. The exchange rate is good — a render is tens of
milliseconds, and the cache means you pay it about once per revision — but it is
why the chart's CPU limit is a whole core. A limit below that turns a burst of
pushes into throttled requests.

If you do not want the pictures at all, `DRAW=false` makes this a pure document
store that answers `tiles: []`, which the contract explicitly allows and the CLI
reports as "0 diagrams".

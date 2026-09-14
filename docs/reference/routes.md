# Routes

Version 1 of the [canvas API](https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md)
in full, plus the pages and the pictures. That page is the authority on the
shapes; this one says what this server does with them.

## The contract's five

| Route | |
| --- | --- |
| `POST /api/canvas` | Mint. 201, the write token in plaintext this once, `rev: 0`. |
| `GET /api/canvas/{id}` | Fetch. The document exactly as pushed, plus tiles. No authentication: the id is the capability. |
| `PUT /api/canvas/{id}` | Push. `If-Match` is the revision last seen; quotes tolerated. |
| `POST /api/canvas/{id}/rotate` | Rotate. Replay-safe, and the CLI's way of checking a token. |
| `DELETE /api/canvas/{id}` | Delete. Idempotent: a canvas already gone answers `NOT_FOUND`. |

Push runs the contract's eight checks in its order, first failure wins:
`If-Match` → size → JSON → token → rate → revision → schema → drawable. A
refused push changes nothing.

## The pages

| Route | Serves |
| --- | --- |
| `GET /c/{id}` | The canvas page: every tile, both themes, no script and nothing off this origin. |
| `GET /c/{id}.svg` | The hero as an SVG. `?theme=dark` for the other half. |
| `GET /images/{id}/{name}-{hash}.svg` | One picture, addressed by its own hash. |
| `GET /healthz` | Liveness. This process only. |
| `GET /readyz` | Readiness. Asks the store. |

`/c/{id}` is where the contract asks the canvas page to be: `pr-lens canvas pull`
accepts a pasted link only at that path, and takes its origin as the API to call.

## Tiles

Two kinds:

- `view:{viewId}` — one per drill-down view, in the order the document declares
  them, `crumbs` giving the view's place in the tree, root first and itself last
- `lens:{lens}` — the whole map, for a document with no views

There are no `flow:{flowId}` tiles. The renderer draws a flow inside its
data-flow view rather than on its own, and the contract leaves which views a
server draws to the server. A walkthrough step staging a flow is therefore
satisfied by any data-flow tile; one staging a view this server did not draw is
`CANNOT_DRAW`.

`renders` carries each picture's content hash — the contract's opaque handle.
`images` carries the URL under `/images/{id}/`.

With `DRAW=false`, every answer is `tiles: []` and the picture routes are empty.

## Errors

Every code in the contract's table, with the extra field each one carries:
`NOT_FOUND`, `INVALID_REQUEST`, `INVALID_DOCUMENT` (`issues`), `CANNOT_DRAW`,
`REVISION_MOVED` (`rev`), `DELETION_INCOMPLETE`, `RATE_LIMITED` (`retryAt`),
`TOO_LARGE`.

`NOT_FOUND` deliberately covers three cases with one answer — an id nobody
minted, a right id with a wrong token, and a canvas minted but never pushed to —
so that a guesser cannot learn which ids exist.

An internal fault leaves as a bare 500 with **no** envelope. The client reads
that as the server being unavailable, which is the truth; a made-up code would be
a lie it would act on.

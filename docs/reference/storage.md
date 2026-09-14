# Storage layout

One JSON file per canvas, in the repository named by `GITLAB_PROJECT`, on the
branch named by `GITLAB_BRANCH`.

```
canvases/Qk/Qk3vZp9xLm2aRt8yWn4bCg.json
```

`canvases` is `GITLAB_PREFIX`. `Qk` is the first two characters of the id — a
shard, so the tree never becomes one enormous directory. Nothing reads a
directory listing; every lookup is by path.

## The record

```json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "rev": 3,
  "tokenHash": "sha256:9f8e…",
  "createdAt": "2026-09-01T10:04:11.221Z",
  "updatedAt": "2026-09-14T08:22:03.914Z",
  "document": { "kind": "graph", "schemaVersion": "0.3.0", "…": "…" }
}
```

| Field | |
| --- | --- |
| `id` | Must match the path. A file holding a different id is refused rather than served. |
| `rev` | The revision counter. `0` between minting and the first push, when a fetch answers `NOT_FOUND`. |
| `tokenHash` | SHA-256 of the write token, compared in constant time. The token itself is never stored. |
| `document` | The graph document exactly as pushed. `null` until the first push. |

Files are written base64-encoded, so a document holding any byte sequence
survives the round trip without GitLab guessing at an encoding.

## Commits

One commit per write, and no writes other than these:

| Message | When |
| --- | --- |
| `canvas {id}: mint` | `POST /api/canvas` |
| `canvas {id}: rev {n}` | a successful push |
| `canvas {id}: rev {n}` (unchanged `rev`) | a token rotation |
| `canvas {id}: delete` | a successful delete |

So `git log -- canvases/Qk/{id}.json` is the canvas's revision history, and
`git show` on any of those commits is a revision the API itself will not serve.
Deleting a canvas removes the file; the history stays, which is worth knowing if
"for good" has to mean the history too.

## Pictures

Not stored. They are redrawn from the document on demand — see
[determinism and caching](../explanation/determinism-and-caching.md). The
repository holds documents and nothing else.

# pr-lens-gitlab-backend

A private [PR Lens](https://github.com/coldteadotai/pr-lens) canvas server, with
a GitLab repository as the store.

It speaks version 1 of the [canvas API](https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md)
in full, so `pr-lens canvas push`, `pull`, `rotate` and `delete` work against it
exactly as they do against prlens.dev, and a document pushed here never touches
prlens.dev.

```bash
export PR_LENS_API_URL=https://lens.example.com
pr-lens canvas push
```

It also draws. The renderer is MIT, so this server runs it: every push comes
back with the same tiles the hosted app would answer with, and the pictures are
served from content-addressed URLs that a CDN can keep for ever.

## Why a GitLab repository

The canvas API needs one thing that is easy to get wrong: `If-Match` has to be a
real compare-and-swap. Two writers holding the same revision both push, and
exactly one may win — the other has to be told `REVISION_MOVED` and the failed
push must change nothing.

GitLab's Commits API gives that away for free. An `update` action carries
`last_commit_id`, and GitLab refuses the commit if that is no longer the blob's
last commit. So a canvas is one JSON file, and the revision check is the
repository's own:

```
canvases/Qk/Qk3vZp9xLm2aRt8yWn4bCg.json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "rev": 3,
  "tokenHash": "sha256:…",
  "createdAt": "…",
  "updatedAt": "…",
  "document": { "kind": "graph", … }
}
```

What the repository throws in: every push is a commit, so `git log` over a
canvas file is the revision history the API deliberately does not expose, and
`git show` is a revision you can read.

The alternatives, for the record:

| GitLab primitive | Verdict |
| --- | --- |
| **Repository files, via the Commits API** | What this uses. `last_commit_id` is a true CAS; 300 MB request limit against the contract's 4 MB documents. |
| Snippets | Each is a git repo, so versions exist, but the update API has no CAS: two concurrent pushes silently last-write-wins. |
| Issue notes | No. 1 MB per note against 4 MB documents, no CAS, JSON hiding in a fenced block, and every push spams the issue. |
| Generic package registry | Immutable versions map nicely to revisions, but `NOT_FOUND` versus conflict gets muddy and deleting every revision is awkward. |

### What it costs

A GitLab API call is 100–300 ms and metered, so the read path does not make one
per request. Reads are cached in memory for `READ_CACHE_TTL_MS` (5 s by
default), which is safe because a stale read is never the basis of a write: the
etag travels with it, the store compares it, and a stale etag comes back as a
conflict. A conflict then re-reads past the cache, so the revision a client is
told to pull is always the true one.

Mint, push, rotate and delete are one commit each. Nothing else writes.

## The CDN half

Pictures are redrawn from the stored document rather than stored themselves. The
renderer reads no clock, no file and no random number, so the same document
always produces the same bytes — which means any instance can serve any picture
it holds the document for, and there is no second place to put bytes.

That determinism is what makes the addresses work:

| Route | Cache-Control | Why |
| --- | --- | --- |
| `/api/canvas/…` | `no-store` | The contract asks for it: nothing between the CLI and the server should keep a document under an address meant to stay secret. |
| `/c/{id}` | `no-store` | The page carries the document's title and summary. |
| `/c/{id}.svg` | `public, max-age=60, stale-while-revalidate=300` + ETag | The embed's address does not change when the picture does, so it revalidates against the render's own hash. |
| `/images/{id}/{name}-{hash}.svg` | `public, max-age=31536000, immutable` | The hash is in the name. These bytes can never change. |

Put a CDN in front and the only thing that reaches this server is the API and
the occasional revalidation.

## Running it

```bash
npm ci
STORE=memory npm start           # forgets everything on restart; for a look around
```

Against a GitLab project:

```bash
export STORE=gitlab
export GITLAB_PROJECT=my-group/pr-lens-canvases   # id or path
export GITLAB_TOKEN=glpat-…                       # api scope, Developer role
export PUBLIC_URL=https://lens.example.com
npm start
```

The store is pinged before the socket opens, so a bad token or a missing project
is a startup failure with a sentence about it rather than a server that accepts a
push and then loses it.

### Docker

```bash
docker run -p 8787:8787 \
  -e STORE=gitlab \
  -e GITLAB_PROJECT=my-group/pr-lens-canvases \
  -e GITLAB_TOKEN=glpat-… \
  -e PUBLIC_URL=https://lens.example.com \
  ghcr.io/thejoeejoee/pr-lens-gitlab-backend:0.1.0
```

### Helm

The chart is an OCI artifact beside the image. It creates no Secret — the token
belongs to whatever manages your secrets — so point it at one whose keys become
environment:

```bash
kubectl create secret generic pr-lens-gitlab \
  --from-literal=GITLAB_TOKEN=glpat-…

helm install lens oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend \
  --version 0.1.0 \
  --set secretName=pr-lens-gitlab \
  --set config.gitlab.project=my-group/pr-lens-canvases \
  --set config.publicUrl=https://lens.example.com \
  --set ingress.enabled=true \
  --set ingress.host=lens.example.com
```

For Gateway API instead of an Ingress:

```bash
  --set httpRoute.enabled=true \
  --set httpRoute.hostnames[0]=lens.example.com \
  --set httpRoute.parentRefs[0].name=my-gateway
```

The chart renders a Deployment, a Service and one of the two routes. Nothing
else: no ServiceAccount, no HPA, no PodDisruptionBudget. `charts/pr-lens-gitlab-backend/values.yaml`
documents every setting.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | — | Origin the answers' URLs are built from. Unset, and each answer names whichever host the request arrived on. |
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Where to listen. |
| `STORE` | `gitlab` | `gitlab` or `memory`. |
| `GITLAB_URL` | `https://gitlab.com` | Your instance, for a self-hosted one. |
| `GITLAB_PROJECT` | — | Numeric id or full path. Required for the GitLab store. |
| `GITLAB_TOKEN` | — | Project access token, `api` scope, Developer role. |
| `GITLAB_BRANCH` | `main` | Branch the canvases live on. |
| `GITLAB_PREFIX` | `canvases` | Directory inside the repository. |
| `GITLAB_AUTHOR_NAME`, `GITLAB_AUTHOR_EMAIL` | `pr-lens-gitlab-backend`, `…@localhost` | Commit author. |
| `MAX_BODY_BYTES` | `4000000` | Above this, `TOO_LARGE`. The hosted app's limit. |
| `READ_CACHE_TTL_MS` | `5000` | How long a read may be answered from memory. `0` disables. |
| `RENDER_CACHE_BYTES` | `64000000` | Ceiling on rendered SVG bytes held in memory. |
| `DRAW` | `true` | `false` makes this a pure store: every answer carries `tiles: []`. |
| `MINTS_PER_HOUR_PER_IP` | `60` | `0` turns the meter off. |
| `PUSHES_PER_MINUTE_PER_CANVAS` | `30` | `0` turns the meter off. |
| `IMAGE_CACHE_CONTROL` | `public, max-age=31536000, immutable` | For the content-addressed pictures. |
| `EMBED_CACHE_CONTROL` | `public, max-age=60, stale-while-revalidate=300` | For `/c/{id}.svg`. |
| `TRUST_PROXY` | `false` | Believe `x-forwarded-for` and `x-forwarded-proto`. Only behind a proxy you own. |
| `LOG_REQUESTS` | `true` | One line per request, with canvas ids redacted. |

`.env.example` has the same list with the reasoning attached.

## What it implements

All five routes, the whole error table, and both extra pages.

| Route | |
| --- | --- |
| `POST /api/canvas` | Mint. 201, plaintext token once, `rev: 0`. |
| `GET /api/canvas/{id}` | Fetch. The document exactly as pushed, plus tiles. |
| `PUT /api/canvas/{id}` | Push. `If-Match` is the revision; the eight checks happen in the contract's order. |
| `POST /api/canvas/{id}/rotate` | Rotate, replay-safe, and the CLI's way of checking a token. |
| `DELETE /api/canvas/{id}` | Delete, idempotent. |
| `GET /c/{id}` | The canvas page: every tile, both themes, no script and nothing off this origin. |
| `GET /c/{id}.svg` | The hero, as SVG. `?theme=dark` for the other half. |
| `GET /images/{id}/{file}` | One picture, addressed by its own hash. |
| `GET /healthz`, `GET /readyz` | Liveness is this process; readiness asks GitLab. |

Tiles are `view:{id}` for each drill-down view and `lens:{lens}` for a document
with no views. There are no `flow:{id}` tiles: the renderer draws a flow inside
its data-flow view rather than on its own, and the contract leaves which views a
server draws to the server.

### Security

- **Both secrets are 128 random bits**, base64url, 22 characters, as the contract
  specifies. The id is the read capability, the token the write capability.
- **Only a hash of the token is stored**, and compared in constant time. A copy
  of the repository is not a copy of every token — there is a test for that.
- **`NOT_FOUND` covers three cases with one answer**: an id nobody minted, a
  right id with a wrong token, and a canvas minted but never pushed to. A server
  that distinguished them would tell a guesser which ids exist.
- **Ids stay out of the logs.** An id is a read capability, so request lines are
  written as `/api/canvas/:id`. An access log should not be a list of everybody's
  canvases.
- **The write token rides in a URL fragment** and nowhere else, so no browser
  sends it to a server or a referrer.
- **An internal fault leaves without an envelope.** The CLI reads a bare 500 as
  the server being unavailable, which is the truth; a made-up code would be a lie
  it would act on.

## Development

```bash
npm ci
npm test          # 35 tests: the contract over HTTP, the store against a fake GitLab
npm run typecheck
npm run dev       # reloads on change
npm run build     # dist/, which is what gets published
```

The sources are TypeScript run directly by Node — no bundler, no loader, no build
step to develop against. Node 22.18 or newer strips the types itself; the
published package and the container image run the compiled `dist/`.

`test/fake-gitlab.ts` is the interesting one. It reproduces the two endpoints
this server uses along with the exact wording GitLab uses to report a conflict,
because "the blob moved under you" and "another commit reached the branch first"
arrive as the same 400 and only the sentence tells them apart — one is a conflict
to hand back, the other is worth retrying.

## Releasing

A `v*` tag publishes all three, each carrying the same number:

- the npm package, with provenance
- `ghcr.io/thejoeejoee/pr-lens-gitlab-backend`, for amd64 and arm64
- `oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend`

The release refuses to start unless the tag, `package.json` and the chart's
`version` and `appVersion` all agree, so a chart left behind cannot quietly
install the previous image.

```bash
npm version minor          # or edit all three by hand
# bump version and appVersion in charts/pr-lens-gitlab-backend/Chart.yaml to match
git push --follow-tags
```

`NPM_TOKEN` is the only secret to add; the container and the chart use
`GITHUB_TOKEN`.

## License

MIT. The renderer and schema packages it builds on are MIT too.

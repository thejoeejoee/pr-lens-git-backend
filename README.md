<div align="center">

# 🗺️ pr-lens-gitlab-backend

**A private [PR Lens](https://github.com/coldteadotai/pr-lens) canvas server — with a GitLab repository as the whole database.**

[![ci](https://github.com/thejoeejoee/pr-lens-gitlab-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/thejoeejoee/pr-lens-gitlab-backend/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pr-lens-gitlab-backend?logo=npm&color=cb3837)](https://www.npmjs.com/package/pr-lens-gitlab-backend)
[![image](https://img.shields.io/badge/ghcr.io-amd64%20%2B%20arm64-2496ed?logo=docker&logoColor=white)](https://github.com/thejoeejoee/pr-lens-gitlab-backend/pkgs/container/pr-lens-gitlab-backend)
[![helm](https://img.shields.io/badge/helm-OCI-0f1689?logo=helm&logoColor=white)](docs/how-to/deploy-with-helm.md)
[![canvas API](https://img.shields.io/badge/canvas%20API-v1-8b5cf6)](https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

It speaks version 1 of the
[canvas API](https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md)
in full, so `pr-lens canvas push`, `pull`, `rotate` and `delete` work against it
exactly as against prlens.dev — and a document pushed here never touches
prlens.dev.

```bash
export PR_LENS_API_URL=https://lens.example.com
pr-lens canvas push
```

It draws, too. The renderer is MIT, so pushes come back with the same tiles the
hosted app would answer with — this is a real one, straight out of `renderAll`:

<div align="center">
<picture>
  <source srcset="docs/assets/example-dark.svg" media="(prefers-color-scheme: dark)">
  <img src="docs/assets/example-light.svg" alt="A PR Lens architecture diagram: lanes of services with a changed send pipeline highlighted" width="820">
</picture>
</div>

## 🧩 Why a GitLab repository is enough

The contract needs one thing that is easy to get wrong: `If-Match` has to be a
**real compare-and-swap**, or two pushes on the same revision silently overwrite
each other.

GitLab's Commits API gives that away. An `update` action carries
`last_commit_id`, and GitLab refuses the commit if that is no longer the blob's
last commit — a compare-and-swap on one file, from an API that is already
authenticated and already running in your organisation:

```mermaid
sequenceDiagram
    autonumber
    participant C as pr-lens CLI
    participant S as this server
    participant G as GitLab

    C->>S: PUT /api/canvas/{id} · If-Match 3
    S->>G: GET canvases/Qk/{id}.json
    G-->>S: rev 3 · last_commit_id abc123
    S->>G: POST commits · update · last_commit_id abc123
    alt abc123 is still the blob's last commit
        G-->>S: 201 committed
        S-->>C: 200 · rev 4 · tiles
    else somebody committed first
        G-->>S: 400 the file has changed
        S-->>C: 409 REVISION_MOVED · rev 4
    end
```

No database, no lock, no lease. And a bonus the contract explicitly does not
offer: every push is a commit, so `git log` over a canvas file **is** the
revision history.

Snippets have versions but no CAS; notes cap at 1 MB against the contract's 4 MB
documents. [The long version](docs/explanation/why-gitlab.md) has the reasoning
and the costs.

## 🚀 Start here

```bash
STORE=memory npx pr-lens-gitlab-backend   # forgets everything on restart
```

Then [the tutorial](docs/tutorial.md) — a canvas of your own, in a GitLab project
of your own, in about ten minutes.

## 📚 Documentation

| | |
| --- | --- |
| 🎓 **[Tutorial](docs/tutorial.md)** | Your first canvas, from nothing. |
| 🔧 **How-to** | [Self-managed GitLab](docs/how-to/self-managed-gitlab.md) · [Deploy with Helm](docs/how-to/deploy-with-helm.md) · [Put a CDN in front](docs/how-to/put-a-cdn-in-front.md) · [Cut a release](docs/how-to/releasing.md) |
| 📖 **Reference** | [Configuration](docs/reference/configuration.md) · [Routes](docs/reference/routes.md) · [Storage layout](docs/reference/storage.md) |
| 💡 **Explanation** | [Why GitLab works](docs/explanation/why-gitlab.md) · [Determinism and caching](docs/explanation/determinism-and-caching.md) |

## ⚡ The CDN half

Pictures are never stored. The renderer reads no clock, no file and no random
number, so the same document always produces the same bytes — which means any
replica can redraw any picture it holds the document for, and a picture's hash
can be its name:

| Route | `Cache-Control` | |
| --- | --- | --- |
| `/images/{id}/…-{hash}.svg` | `immutable`, one year | ♾️ the hash is in the name, so these bytes can never change |
| `/c/{id}.svg` | 60 s + ETag | 🔄 the embed address stays put, so it revalidates on the render's hash |
| `/c/{id}` · `/api/canvas/…` | `no-store` | 🔒 the contract's own rule: no cache may keep a document under a secret address |

Put a CDN in front and the only traffic reaching this server is the API. No CDN
to reach for? `cache.enabled=true` puts [Vinyl Cache](https://vinyl-cache.org) in
the pod as a sidecar and points the Service at it — and it needs no path rules,
because the headers above are already the whole policy.
[How, and the one thing to get right](docs/how-to/put-a-cdn-in-front.md).

## 🔐 Security in one list

- 🎲 Ids and tokens are 128 random bits, base64url, as the contract specifies.
  The id is the read capability, the token the write capability.
- 🧂 Only a hash of the token is stored, compared in constant time. A copy of the
  repository is not a copy of every token — there is a test for exactly that.
- 🕳️ `NOT_FOUND` covers an unminted id, a wrong token and an unpushed canvas with
  one answer, so a guesser learns nothing.
- 📓 Ids stay out of the logs. An access log should not be a list of live canvases.
- 🔗 The write token rides in a URL fragment and nowhere else, so no browser
  sends it to a server or a referrer.
- 🤐 An internal fault leaves as a bare 500 with no envelope, which the CLI reads
  as "unavailable" — the truth, rather than a made-up code it would act on.

## 🛠️ Development

```bash
npm ci
npm test          # 35: the contract over HTTP, the store against a fake GitLab
npm run typecheck
npm run dev       # reloads on change
npm run build     # dist/, which is what gets published
```

TypeScript run directly by Node — no bundler, no loader, no build step to develop
against. Node 22.18 or newer strips the types itself; the published package and
the container image run the compiled `dist/`.

A `v*` tag releases all three artifacts at the same version — npm with
provenance, `ghcr.io/thejoeejoee/pr-lens-gitlab-backend` for amd64 and arm64, and
`oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend` — and refuses to start
unless the tag, `package.json` and the chart's `version` and `appVersion` all
agree. There are no publishing secrets: npm is reached over OIDC as a trusted
publisher, ghcr with the built-in token.
[Releasing](docs/how-to/releasing.md) has the setup.

## 📄 License

MIT, as are the renderer and schema packages it builds on.

<div align="center">
<sub>The diagram above is rendered from <code>@coldtea/pr-lens-schema</code>'s own example document.</sub>
</div>

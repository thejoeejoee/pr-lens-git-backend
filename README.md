# pr-lens-gitlab-backend

A private [PR Lens](https://github.com/coldteadotai/pr-lens) canvas server, with
a GitLab repository as the store.

It speaks version 1 of the
[canvas API](https://github.com/coldteadotai/pr-lens/blob/main/docs/canvas-api.md)
in full, so `pr-lens canvas push`, `pull`, `rotate` and `delete` work against it
exactly as against prlens.dev — and a document pushed here never touches
prlens.dev. It draws, too: the renderer is MIT, so pushes come back with the same
tiles the hosted app would answer with.

```bash
export PR_LENS_API_URL=https://lens.example.com
pr-lens canvas push
```

## Why a GitLab repository is enough

The contract needs one thing that is easy to get wrong: `If-Match` has to be a
real compare-and-swap, or two pushes on the same revision silently overwrite each
other.

GitLab's Commits API gives that away. An `update` action carries
`last_commit_id`, and GitLab refuses the commit if that is no longer the blob's
last commit — a compare-and-swap on one file, from an API that is already
authenticated and already running in your organisation. So a canvas is one JSON
file, and the revision check is the repository's own. As a bonus, every push is a
commit, so `git log` over a canvas file is the revision history the API
deliberately does not expose.

Snippets have versions but no CAS; notes cap at 1 MB against the contract's 4 MB
documents. [The long version](docs/explanation/why-gitlab.md) has the reasoning
and the costs.

## Start here

```bash
npm ci
STORE=memory npm start     # forgets everything on restart; for a look around
```

Then [the tutorial](docs/tutorial.md) — a canvas of your own, in a project of
your own, in about ten minutes.

## Documentation

| | |
| --- | --- |
| **[Tutorial](docs/tutorial.md)** | Your first canvas, from nothing. |
| **How-to** | [Self-managed GitLab](docs/how-to/self-managed-gitlab.md) · [Deploy with Helm](docs/how-to/deploy-with-helm.md) · [Put a CDN in front](docs/how-to/put-a-cdn-in-front.md) |
| **Reference** | [Configuration](docs/reference/configuration.md) · [Routes](docs/reference/routes.md) · [Storage layout](docs/reference/storage.md) |
| **Explanation** | [Why GitLab works](docs/explanation/why-gitlab.md) · [Determinism and caching](docs/explanation/determinism-and-caching.md) |

## Security in one list

- Ids and tokens are 128 random bits, base64url, as the contract specifies. The
  id is the read capability, the token the write capability.
- Only a hash of the token is stored, compared in constant time. A copy of the
  repository is not a copy of every token — there is a test for that.
- `NOT_FOUND` covers an unminted id, a wrong token and an unpushed canvas with
  one answer, so a guesser learns nothing.
- Ids stay out of the logs. An access log should not be a list of live canvases.
- The write token rides in a URL fragment and nowhere else, so no browser sends
  it to a server or a referrer.
- An internal fault leaves as a bare 500 with no envelope, which the CLI reads as
  "unavailable" — the truth, rather than a made-up code it would act on.

## Development

```bash
npm ci
npm test          # the contract over HTTP, the store against a fake GitLab
npm run typecheck
npm run dev       # reloads on change
npm run build     # dist/, which is what gets published
```

TypeScript run directly by Node — no bundler, no loader, no build step to develop
against. Node 22.18 or newer strips the types itself; the published package and
the container image run the compiled `dist/`.

A `v*` tag releases the container image
(`ghcr.io/thejoeejoee/pr-lens-gitlab-backend`, amd64 and arm64) and the Helm chart
(`oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend`) at the same version,
and refuses to start unless the tag, `package.json` and the chart's `version` and
`appVersion` all agree. Publishing to npm is written and wired but switched off —
the `npm` job in `.github/workflows/release.yml` carries an `if: false` to remove
when there is an `NPM_TOKEN`.

## License

MIT, as are the renderer and schema packages it builds on.

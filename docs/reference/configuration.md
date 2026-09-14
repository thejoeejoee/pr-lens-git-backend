# Configuration

Every setting is an environment variable, read once at startup. A missing one
with no safe default is a startup failure, not a 500 on the first request.

## Server

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Interface to bind. |
| `PORT` | `8787` | Port to bind. |
| `PUBLIC_URL` | — | Origin the answers' URLs are built from. Unset, and each answer names whichever host the request arrived on. |
| `TRUST_PROXY` | `false` | Believe `x-forwarded-for` and `x-forwarded-proto`. Only behind a proxy you own. |
| `LOG_REQUESTS` | `true` | One line per request, with canvas ids redacted. |
| `INDEX_PAGE` | `true` | Serve the explanatory page at `/`. `false` answers `NOT_FOUND` there instead. |

## Store

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORE` | `gitlab` | `gitlab`, or `memory` for a store that forgets on restart. |
| `GITLAB_URL` | `https://gitlab.com` | Your instance. See [self-managed GitLab](../how-to/self-managed-gitlab.md). |
| `GITLAB_PROJECT` | — | Numeric id or full path. Required when `STORE=gitlab`. |
| `GITLAB_TOKEN` | — | Project access token, `api` scope, Developer role. |
| `GITLAB_BRANCH` | `main` | Branch the canvases live on. |
| `GITLAB_PREFIX` | `canvases` | Directory inside the repository. |
| `GITLAB_AUTHOR_NAME` | `pr-lens-gitlab-backend` | Commit author name. |
| `GITLAB_AUTHOR_EMAIL` | `pr-lens-gitlab-backend@localhost` | Commit author email. |
| `USER_AGENT_HOST` | the machine's host name | The host named in the `User-Agent` sent to GitLab. Empty omits it. |

## Limits and caches

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_BODY_BYTES` | `4000000` | Above this, `TOO_LARGE`. The hosted app's limit. |
| `READ_CACHE_TTL_MS` | `5000` | How long a read may be answered from memory. `0` disables. |
| `RENDER_CACHE_BYTES` | `64000000` | Ceiling on rendered SVG bytes held in memory, evicted least-recently-used. |
| `DRAW` | `true` | `false` makes this a pure store: every answer carries `tiles: []`. |
| `MINTS_PER_HOUR_PER_IP` | `60` | `0` turns the meter off. Per pod. |
| `PUSHES_PER_MINUTE_PER_CANVAS` | `30` | `0` turns the meter off. Per pod. |
| `IMAGE_CACHE_CONTROL` | `public, max-age=31536000, immutable` | For the content-addressed pictures. |
| `EMBED_CACHE_CONTROL` | `public, max-age=60, stale-while-revalidate=300` | For `/c/{id}.svg`. |
| `NODE_EXTRA_CA_CERTS` | — | Node's own: a CA bundle for a GitLab behind a private CA. |

`.env.example` carries the same list with the reasoning attached.

## Chart values

`charts/pr-lens-gitlab-backend/values.yaml` maps onto the table above under
`config.*`, and documents the Kubernetes-only settings: `secretName`,
`ingress`, `httpRoute`, `resources`, `extraEnv`, `extraVolumes`,
`extraVolumeMounts`.

## What GitLab sees

Every call carries a `User-Agent` naming this server, its version and the
instance:

```
pr-lens-gitlab-backend/0.2.0 (lens-7b9f4-xk2)
```

The host is in the parenthesised comment because that is what RFC 9110 reserves
for it — `@` is not a legal character in a product version, however common the
habit. It is there so a rate limit or an audit entry can be traced to one replica
rather than to "the canvas server".

In a pod that host is the pod name, which is exactly what you want. On a laptop it
is the machine's name, which may be somebody's name and may be going to
gitlab.com — hence `USER_AGENT_HOST`, which replaces it, or empties it for a plain
`pr-lens-gitlab-backend/0.2.0`.

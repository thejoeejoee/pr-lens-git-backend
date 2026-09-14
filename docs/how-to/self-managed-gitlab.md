# Use a self-managed GitLab

Point `GITLAB_URL` at your instance. Nothing else changes: every request the
store makes is `{GITLAB_URL}/api/v4/projects/…`, so gitlab.com is only a default.

```bash
export GITLAB_URL=https://git.example.com
export GITLAB_PROJECT=platform/pr-lens-canvases
export GITLAB_TOKEN=glpat-…
```

A sub-path install works too — `https://example.com/gitlab` becomes
`https://example.com/gitlab/api/v4/…`.

## If the instance is behind a private CA

Node will refuse the TLS handshake. Give it the bundle:

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/gitlab/ca.crt
```

In the chart, mount the bundle and name it through `extraEnv`:

```yaml
extraVolumes:
  - name: gitlab-ca
    configMap:
      name: gitlab-ca
extraVolumeMounts:
  - name: gitlab-ca
    mountPath: /etc/ssl/gitlab
    readOnly: true
extraEnv:
  - name: NODE_EXTRA_CA_CERTS
    value: /etc/ssl/gitlab/ca.crt
```

## What the instance has to support

The two endpoints the store uses, both present since GitLab 11:

- `GET /projects/:id/repository/files/:path` — must answer `last_commit_id`
- `POST /projects/:id/repository/commits` — must honour `last_commit_id` on
  `update` and `delete` actions

That second one is the whole compare-and-swap, so it is worth checking on an
unusual install. A push that lands twice on the same revision means it is being
ignored.

## Rate limits

Self-managed instances often meter the API harder than gitlab.com. When GitLab
answers 429, this server passes it on as `RATE_LIMITED` with the `Retry-After` it
was given, so the CLI tells the user a time rather than failing obscurely. Raise
`READ_CACHE_TTL_MS` if fetches are what you are hitting the limit with.

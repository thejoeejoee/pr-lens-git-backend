# Connect a remote

`GIT_REMOTE` takes anything `git fetch` and `git push` take. The store runs the
real `git`, so a remote that works from your shell works here — gitlab.com, a
self-managed GitLab, GitHub, Gitea, Forgejo, Bitbucket, a bare repository on a
host you can reach over ssh.

Two things have to be true of it, and nothing else:

- the branch named by `GIT_BRANCH` is **not protected against this identity**,
  since every write is a push to it
- pushes are **not rewritten** on the way in — no squashing hook, no auto-merge
  robot. A hook that changes what was pushed breaks the compare-and-swap, because
  the next writer reads bytes nobody composed.

An empty repository is fine. The first mint creates the branch.

## Over https, with a token

```bash
export GIT_REMOTE=https://gitlab.example.com/platform/pr-lens-canvases.git
export GIT_TOKEN=glpat-…
```

The token is sent as an `Authorization: Basic` header built from
`GIT_USERNAME:GIT_TOKEN`, through git's configuration in the environment — not in
the URL, which would end up in `git remote -v`, in error messages and in the
mirror's config file, and not on the command line, which anybody running `ps`
can read.

`GIT_USERNAME` defaults to `oauth2`, which most hosts ignore when the password is
a token. The ones that do not:

| Host | What to use |
| --- | --- |
| GitLab | a project access token, `write_repository` scope, Developer role |
| GitHub | a fine-grained PAT with **Contents: read and write**; `GIT_USERNAME` may be anything |
| Bitbucket | an app password, with `GIT_USERNAME=x-token-auth` |
| Gitea, Forgejo | an access token with write access to the repository |

Note what the scope is now: **`write_repository`, not `api`.** The old store
needed the whole API; this one needs a repository it can push to, which is a
smaller thing to hand out.

## Over ssh, with a key

```bash
export GIT_REMOTE=ssh://git@github.com/my-org/pr-lens-canvases.git
export GIT_SSH_COMMAND="ssh -i /etc/pr-lens/ssh/id_ed25519 -o IdentitiesOnly=yes"
```

Leave `GIT_TOKEN` unset. The environment is passed through to git untouched, so
`GIT_SSH_COMMAND` is the whole mechanism — and the key file has to be readable by
the user the server runs as, and no more than that. The host key has to be known,
or the connection will not be made: mount a `known_hosts` and name it with
`-o UserKnownHostsFile=…`.

In the chart:

```yaml
config:
  git:
    remote: ssh://git@github.com/my-org/pr-lens-canvases.git
secretName: ""            # nothing for GIT_TOKEN to be

extraVolumes:
  - name: ssh
    secret:
      secretName: pr-lens-ssh
      defaultMode: 0400
extraVolumeMounts:
  - name: ssh
    mountPath: /etc/pr-lens/ssh
    readOnly: true
extraEnv:
  - name: GIT_SSH_COMMAND
    value: >-
      ssh -i /etc/pr-lens/ssh/id_ed25519 -o IdentitiesOnly=yes
      -o UserKnownHostsFile=/etc/pr-lens/ssh/known_hosts
```

## If the host is behind a private CA

git will refuse the TLS handshake. Give it the bundle:

```bash
export GIT_SSL_CAINFO=/etc/ssl/internal/ca.crt
```

In the chart, mount the bundle and name it through `extraEnv`, the same shape as
the ssh key above. `NODE_EXTRA_CA_CERTS` is not what does it any more: the TLS
connection to the repository is git's, not node's.

## Where the mirror lives

`GIT_MIRROR_DIR` — `/tmp/pr-lens-canvases.git` by default, and in the chart it is
under the `emptyDir` at `/tmp`, because that is the one writable path when the
root filesystem is read-only.

It is a cache. Deleting it costs a clone and nothing else, which is also what
happens every time a pod moves. What it does do is grow, one commit per push, so
for a busy install give the volume room (`tmpSize`) and delete the directory when
it gets unreasonable. Automatic gc is turned off deliberately — a repack firing
in the middle of a push is a stall nobody asked for.

## Finding this server in the host's logs

Every https call names itself:

```
pr-lens-git-backend/0.2.0 (lens-7b9f4-xk2)
```

The bracketed part is the instance — the pod name in a cluster — so a rate limit
or an audit entry points at one replica rather than at "the canvas server".
`USER_AGENT_HOST` overrides it, and empties it if you would rather send nothing.
An ssh remote sends none of this; ssh has no user agent.

## Rate limits

When a host answers 429, this server passes it on as `RATE_LIMITED` with a minute
to wait, so the CLI tells the user a time rather than failing obscurely. git
gives no `Retry-After` to pass through, which is why the minute is a constant
rather than the host's own number.

Raise `GIT_FETCH_TTL_MS` if fetches are what you are hitting the limit with: it
lets a fetched view be reused for that long instead of asking again. Writes are
unaffected — a refused push always re-fetches, whatever the TTL says.

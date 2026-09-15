# Put a CDN in front

The routes already carry the headers for it. Pass `Cache-Control` through and
honour ETags, and the only traffic reaching the server is the API plus the
occasional revalidation.

If you have no CDN to put in front, the chart ships one as a sidecar — see
[the cache sidecar](#the-cache-sidecar) at the end.

## What to cache

| Route | Header it sends | What the CDN should do |
| --- | --- | --- |
| `/images/{id}/…svg` | `public, max-age=31536000, immutable` | Cache it for ever. The hash is in the file name. |
| `/c/{id}.svg` | `public, max-age=60, stale-while-revalidate=300` + ETag | Cache, revalidate on the ETag. |
| `/c/{id}` | `no-store` | Never. |
| `/` | `no-store` | Never. It carries the live canvas count. |
| `/api/canvas/…` | `no-store` | Never. The contract asks for this. |

The two `no-store` routes are not a performance problem: pushes are rare, and a
`GET` on the API is only the CLI's `pull`.

## The one thing to get right

Every canvas id in those paths is a read capability. Caching by full URL is
therefore fine — anyone holding the URL is already authorised — but the cache
must key on the **whole path**, and its access logs are a list of live canvas
ids. Treat them as you would tokens, or turn path logging off for `/c/` and
`/images/`. This server already redacts ids from its own logs for that reason.

## Behind a proxy

```bash
export TRUST_PROXY=true
export PUBLIC_URL=https://lens.example.com
```

`TRUST_PROXY` makes the server believe `x-forwarded-for` and
`x-forwarded-proto`, which is what the mint rate limiter needs to tell clients
apart. Only turn it on behind a proxy you control — otherwise anyone can claim
any address.

## Vary

Nothing here varies on a request header. `/c/{id}.svg?theme=dark` is a different
URL rather than the same one negotiated, and the canvas page picks its theme in
CSS, so no `Vary` handling is needed.

## The cache sidecar

`cache.enabled=true` puts [Vinyl Cache](https://vinyl-cache.org) (what Varnish
Cache was renamed to, now at 9.x) in the pod, in front of the server:

```bash
helm upgrade --install lens oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend \
  --set secretName=pr-lens-git \
  --set config.git.remote=https://gitlab.example.com/platform/pr-lens-canvases.git \
  --set cache.enabled=true
```

The Service and the route then point at the cache, and the app port stops being
reachable through the Service — one way in, so nothing can bypass it.

### It needs no rules

The [default VCL](../../charts/pr-lens-gitlab-backend/files/default.vcl) is about
twenty lines and says nothing about which paths to cache. It does not have to:
the server already declares that with `Cache-Control`, and Vinyl reads `max-age`
and `no-store` itself. So the table above is enforced without a second copy of it
here to drift out of step with the code.

What the VCL does say is three things: writes are never cache candidates,
`Cookie` and `Authorization` are dropped on reads because a canvas id is a
capability rather than an identity, and `/images/` gets 24 hours of grace so a
stale picture can be served while a fresh one is fetched — safe there precisely
because the bytes behind a hashed name never change.

Every response carries `X-Cache: HIT|MISS` and `X-Cache-Hits`, so you can see it
working:

```console
$ curl -sI https://lens.example.com/images/{id}/overview-light-{hash}.svg | grep -i x-cache
x-cache: HIT
x-cache-hits: 4
```

### Sizing it

| Value | Default | |
| --- | --- | --- |
| `cache.size` | `256m` | Cached objects, in the container's heap. Keep it well under the memory limit. |
| `cache.logSize` | `8m` | The shared memory log. Vinyl defaults to 80m, far more than a sidecar nobody runs `varnishlog` against needs. |
| `cache.workdirSize` | `32Mi` | `/var/lib/varnish`, memory-backed, so it counts against the limit too. It has to hold `logSize` plus the compiled VCL. |
| `cache.resources` | 384Mi–512Mi | `size` + `workdirSize` + headroom. Raise all three together. |

Two things that will bite if you change them: the workdir volume must stay
**executable**, because `varnishd` compiles the VCL to a shared object in there
and `dlopen`s it; and `logSize` must fit inside `workdirSize`, or the child
process dies with `No space left on device` at startup.

### Using something else

`cache.image` and `cache.vcl` are the whole interface. Point the image at another
program and put its configuration in `cache.vcl` — it is mounted at
`/etc/varnish/default.vcl`, so anything that can be told to read a config from a
path will do. Two notes on the obvious candidates: Traefik OSS has no HTTP cache
at all (it is a Traefik Hub feature), and Caddy needs the third-party
`cache-handler` plugin, which means building your own image.

### Or don't

The sidecar is off by default, and for good reason: a real CDN is better at this,
and the server is already unbothered by the read path. Turn it on when there is no
CDN to reach for, or when the origin is far from the readers.

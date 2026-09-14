# Put a CDN in front

The routes already carry the headers for it. Pass `Cache-Control` through and
honour ETags, and the only traffic reaching the server is the API plus the
occasional revalidation.

## What to cache

| Route | Header it sends | What the CDN should do |
| --- | --- | --- |
| `/images/{id}/…svg` | `public, max-age=31536000, immutable` | Cache it for ever. The hash is in the file name. |
| `/c/{id}.svg` | `public, max-age=60, stale-while-revalidate=300` + ETag | Cache, revalidate on the ETag. |
| `/c/{id}` | `no-store` | Never. |
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

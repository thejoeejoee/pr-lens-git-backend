vcl 4.1;

backend canvas {
    .host = "127.0.0.1";
    .port = "8787";
    # Longer than the 60 seconds the CLI gives a request, so the cache never
    # gives up on a push before the client would.
    .first_byte_timeout = 70s;
    .between_bytes_timeout = 70s;
}

sub vcl_recv {
    # Mint, push, rotate and delete go straight through. Only GET and HEAD
    # are ever cache candidates.
    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }

    # A canvas id is a capability, not an identity: everyone holding one is
    # entitled to the same bytes. So there is nothing to vary on, and
    # dropping these keeps one reader's copy usable by the next.
    unset req.http.Cookie;
    unset req.http.Authorization;
}

sub vcl_backend_response {
    # Deliberately no rules about what to cache or for how long. The server
    # says so with Cache-Control, and Vinyl reads max-age and no-store
    # itself, so the pictures are kept and the API and the canvas page are
    # not -- with no list of paths here to drift out of step with the code.

    # Serve a stale picture while fetching a fresh one. Only for the
    # content-addressed route, where the bytes behind a name never change,
    # so "stale" cannot be wrong.
    if (bereq.url ~ "^/images/") {
        set beresp.grace = 24h;
    }
}

sub vcl_deliver {
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
    set resp.http.X-Cache-Hits = obj.hits;
}

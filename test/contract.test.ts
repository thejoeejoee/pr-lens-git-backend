import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { payloadGraph } from "@coldtea/pr-lens-schema/examples";

import { call, start, type Harness } from "./harness.ts";

/**
 * The canvas contract, walked end to end the way the CLI walks it.
 *
 * These assertions are copied from the spec rather than from the code, so a
 * refactor that changes an answer's shape fails here. Where the spec fixes an
 * order of checks, the test asks for two failures at once and insists on the
 * earlier one.
 */

const json = { "content-type": "application/json" };

describe("the canvas contract", () => {
  let harness: Harness;
  before(async () => {
    harness = await start({ LOG_REQUESTS: "false" });
  });
  after(async () => harness.close());

  const api = () => `${harness.url}/api/canvas`;

  it("mints a canvas with a plaintext token, rev 0 and three addresses", async () => {
    const minted = await call(api(), { method: "POST" });

    assert.equal(minted.status, 201);
    assert.match(minted.body.id, /^[A-Za-z0-9_-]{22}$/);
    assert.match(minted.body.writeToken, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(minted.body.rev, 0);
    assert.equal(minted.body.viewUrl, `${harness.url}/c/${minted.body.id}`);
    assert.equal(
      minted.body.editUrl,
      `${minted.body.viewUrl}#w=${minted.body.writeToken}`,
    );
    assert.equal(minted.body.embedUrl, `${minted.body.viewUrl}.svg`);
    assert.equal(minted.headers.get("cache-control"), "no-store");
    assert.notEqual(minted.body.id, minted.body.writeToken);
  });

  it("answers NOT_FOUND for a canvas minted but never pushed to", async () => {
    const minted = await call(api(), { method: "POST" });
    const fetched = await call(`${api()}/${minted.body.id}`);

    assert.equal(fetched.status, 404);
    assert.equal(fetched.body.error.code, "NOT_FOUND");
  });

  it("answers NOT_FOUND for an id nobody minted", async () => {
    const fetched = await call(`${api()}/Qk3vZp9xLm2aRt8yWn4bCg`);

    assert.equal(fetched.status, 404);
    assert.equal(fetched.body.error.code, "NOT_FOUND");
  });

  it("stores a document and draws it", async () => {
    const minted = await call(api(), { method: "POST" });
    const { id, writeToken } = minted.body;

    const pushed = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: {
        ...json,
        authorization: `Bearer ${writeToken}`,
        "if-match": "0",
      },
      body: JSON.stringify(payloadGraph),
    });

    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.rev, 1);
    assert.equal(pushed.body.editUrl, `${harness.url}/c/${id}#w=${writeToken}`);
    assert.ok(pushed.body.tiles.length > 0, "the renderer drew nothing");

    const heroes = pushed.body.tiles.filter((tile: any) => tile.hero === true);
    assert.equal(heroes.length, 1, "exactly one tile is the hero");
    assert.equal(pushed.body.tiles[0].hero, true, "and it is the first");

    for (const tile of pushed.body.tiles) {
      assert.match(tile.id, /^(view|flow|lens):/);
      assert.ok(["architecture", "data-flow"].includes(tile.lens));
      assert.equal(typeof tile.title, "string");
      assert.ok(Array.isArray(tile.crumbs));
      assert.ok(tile.width > 0 && tile.height > 0);
      assert.equal(typeof tile.renders.light, "string");
      assert.equal(typeof tile.renders.dark, "string");
      assert.ok(tile.images.light.startsWith(`${harness.url}/images/${id}/`));
      assert.ok(tile.images.dark.startsWith(`${harness.url}/images/${id}/`));
    }

    const fetched = await call(`${api()}/${id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.rev, 1);
    assert.deepEqual(fetched.body.document, JSON.parse(JSON.stringify(payloadGraph)));
    assert.equal(fetched.body.tiles.length, pushed.body.tiles.length);
    // The read answer never carries the write capability.
    assert.equal(fetched.body.editUrl, undefined);
  });

  it("nests crumbs root first and names the view last", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    const pushed = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...json, authorization: `Bearer ${writeToken}`, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });

    for (const tile of pushed.body.tiles) {
      if (!tile.id.startsWith("view:")) continue;
      assert.equal(
        tile.crumbs.at(-1),
        tile.id.slice("view:".length),
        "a view's trail ends at itself",
      );
    }
  });

  it("refuses a push that lands on the wrong revision, and changes nothing", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    const headers = { ...json, authorization: `Bearer ${writeToken}` };

    await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...headers, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });

    const stale = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...headers, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });

    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "REVISION_MOVED");
    assert.equal(stale.body.error.rev, 1);

    const fetched = await call(`${api()}/${id}`);
    assert.equal(fetched.body.rev, 1, "the refused push changed nothing");
  });

  it("tolerates a quoted If-Match", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    const pushed = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: {
        ...json,
        authorization: `Bearer ${writeToken}`,
        "if-match": '"0"',
      },
      body: JSON.stringify(payloadGraph),
    });

    assert.equal(pushed.status, 200);
  });

  it("checks If-Match before the token, and the token before the revision", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;

    // No If-Match and a wrong token: the contract's first check wins.
    const noIfMatch = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...json, authorization: "Bearer Aaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify(payloadGraph),
    });
    assert.equal(noIfMatch.status, 400);
    assert.equal(noIfMatch.body.error.code, "INVALID_REQUEST");

    // A wrong token and a wrong revision: NOT_FOUND, never REVISION_MOVED,
    // which would tell a guesser the canvas exists.
    const wrongToken = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: {
        ...json,
        authorization: "Bearer Aaaaaaaaaaaaaaaaaaaaaa",
        "if-match": "7",
      },
      body: JSON.stringify(payloadGraph),
    });
    assert.equal(wrongToken.status, 404);
    assert.equal(wrongToken.body.error.code, "NOT_FOUND");
  });

  it("refuses a body that is not JSON before it looks at the token", async () => {
    const { id } = (await call(api(), { method: "POST" })).body;
    const answer = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: {
        ...json,
        authorization: "Bearer Aaaaaaaaaaaaaaaaaaaaaa",
        "if-match": "0",
      },
      body: "{oh no",
    });

    assert.equal(answer.status, 400);
    assert.equal(answer.body.error.code, "INVALID_REQUEST");
  });

  it("lists every issue in a document it will not store", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    const answer = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...json, authorization: `Bearer ${writeToken}`, "if-match": "0" },
      body: JSON.stringify({ kind: "graph", title: "not really" }),
    });

    assert.equal(answer.status, 422);
    assert.equal(answer.body.error.code, "INVALID_DOCUMENT");
    assert.ok(answer.body.error.issues.length > 0);
    for (const issue of answer.body.error.issues) {
      assert.equal(typeof issue.code, "string");
      assert.equal(typeof issue.path, "string");
      assert.equal(typeof issue.message, "string");
    }
  });

  it("rotates, replays a rotation, and verifies a token against itself", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    const next = "Ab3dEf5gHi7jKl9mNo1pQr";

    const rotated = await call(`${api()}/${id}/rotate`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${writeToken}` },
      body: JSON.stringify({ writeToken: next }),
    });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.body.editUrl, `${harness.url}/c/${id}#w=${next}`);

    // The same pair again: an answer lost on the way back costs nothing.
    const replayed = await call(`${api()}/${id}/rotate`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${writeToken}` },
      body: JSON.stringify({ writeToken: next }),
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.editUrl, rotated.body.editUrl);

    // A rotation onto itself is how the CLI asks "does this token work?".
    const verified = await call(`${api()}/${id}/rotate`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${next}` },
      body: JSON.stringify({ writeToken: next }),
    });
    assert.equal(verified.status, 200);

    const retired = await call(`${api()}/${id}/rotate`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${writeToken}` },
      body: JSON.stringify({ writeToken: "Zz3dEf5gHi7jKl9mNo1pQr" }),
    });
    assert.equal(retired.status, 404, "the old token no longer writes");
  });

  it("checks the rotation body before the bearer token", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;

    for (const body of [{}, { writeToken: "too-short" }]) {
      const answer = await call(`${api()}/${id}/rotate`, {
        method: "POST",
        headers: { ...json, authorization: "Bearer Aaaaaaaaaaaaaaaaaaaaaa" },
        body: JSON.stringify(body),
      });
      assert.equal(answer.status, 400);
      assert.equal(answer.body.error.code, "INVALID_REQUEST");
    }

    // And the good token still works afterwards.
    const rotated = await call(`${api()}/${id}/rotate`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${writeToken}` },
      body: JSON.stringify({ writeToken }),
    });
    assert.equal(rotated.status, 200);
  });

  it("does not bump the revision when a token rotates", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...json, authorization: `Bearer ${writeToken}`, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });

    const next = "Rr3dEf5gHi7jKl9mNo1pQr";
    await call(`${api()}/${id}/rotate`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${writeToken}` },
      body: JSON.stringify({ writeToken: next }),
    });

    const fetched = await call(`${api()}/${id}`);
    assert.equal(fetched.body.rev, 1);

    const pushed = await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...json, authorization: `Bearer ${next}`, "if-match": "1" },
      body: JSON.stringify(payloadGraph),
    });
    assert.equal(pushed.body.rev, 2);
  });

  it("deletes a canvas, and stays deleted", async () => {
    const { id, writeToken } = (await call(api(), { method: "POST" })).body;
    await call(`${api()}/${id}`, {
      method: "PUT",
      headers: { ...json, authorization: `Bearer ${writeToken}`, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });

    const wrong = await call(`${api()}/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer Aaaaaaaaaaaaaaaaaaaaaa" },
    });
    assert.equal(wrong.status, 404);

    const deleted = await call(`${api()}/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${writeToken}` },
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { id, deleted: true });

    assert.equal((await call(`${api()}/${id}`)).status, 404);
    assert.equal(
      (
        await call(`${api()}/${id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${writeToken}` },
        })
      ).status,
      404,
    );
  });

  it("refuses a body over the limit with TOO_LARGE", async () => {
    const small = await start({ LOG_REQUESTS: "false", MAX_BODY_BYTES: "512" });
    try {
      const { id, writeToken } = (
        await call(`${small.url}/api/canvas`, { method: "POST" })
      ).body;

      const answer = await call(`${small.url}/api/canvas/${id}`, {
        method: "PUT",
        headers: { ...json, authorization: `Bearer ${writeToken}`, "if-match": "0" },
        body: JSON.stringify(payloadGraph),
      });

      assert.equal(answer.status, 413);
      assert.equal(answer.body.error.code, "TOO_LARGE");
    } finally {
      await small.close();
    }
  });

  it("meters minting and names a time to come back", async () => {
    const metered = await start({
      LOG_REQUESTS: "false",
      MINTS_PER_HOUR_PER_IP: "1",
    });
    try {
      assert.equal(
        (await call(`${metered.url}/api/canvas`, { method: "POST" })).status,
        201,
      );
      const refused = await call(`${metered.url}/api/canvas`, { method: "POST" });

      assert.equal(refused.status, 429);
      assert.equal(refused.body.error.code, "RATE_LIMITED");
      assert.ok(
        !Number.isNaN(Date.parse(refused.body.error.retryAt)),
        "retryAt is an ISO 8601 timestamp",
      );
    } finally {
      await metered.close();
    }
  });

  it("answers tiles: [] when it is told not to draw", async () => {
    const plain = await start({ LOG_REQUESTS: "false", DRAW: "false" });
    try {
      const { id, writeToken } = (
        await call(`${plain.url}/api/canvas`, { method: "POST" })
      ).body;

      const pushed = await call(`${plain.url}/api/canvas/${id}`, {
        method: "PUT",
        headers: { ...json, authorization: `Bearer ${writeToken}`, "if-match": "0" },
        body: JSON.stringify(payloadGraph),
      });

      assert.equal(pushed.status, 200);
      assert.deepEqual(pushed.body.tiles, []);
    } finally {
      await plain.close();
    }
  });
});

describe("the pages and the pictures", () => {
  let harness: Harness;
  let id: string;

  before(async () => {
    harness = await start({ LOG_REQUESTS: "false" });
    const minted = await call(`${harness.url}/api/canvas`, { method: "POST" });
    id = minted.body.id;
    await call(`${harness.url}/api/canvas/${id}`, {
      method: "PUT",
      headers: {
        ...json,
        authorization: `Bearer ${minted.body.writeToken}`,
        "if-match": "0",
      },
      body: JSON.stringify(payloadGraph),
    });
  });
  after(async () => harness.close());

  it("serves the canvas page at /c/{id}, which is what pull accepts", async () => {
    const response = await fetch(`${harness.url}/c/${id}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /<h1>/);
    // Nothing off this origin, and no script at all.
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/);
  });

  it("serves the hero as an SVG at /c/{id}.svg, with its render as the etag", async () => {
    const response = await fetch(`${harness.url}/c/${id}.svg`);
    const svg = await response.text();
    const etag = response.headers.get("etag");

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/svg\+xml/);
    assert.match(svg, /^<svg/);
    assert.ok(etag !== null);

    const again = await fetch(`${harness.url}/c/${id}.svg`, {
      headers: { "if-none-match": etag },
    });
    assert.equal(again.status, 304);

    const dark = await fetch(`${harness.url}/c/${id}.svg?theme=dark`);
    assert.notEqual(dark.headers.get("etag"), etag);
  });

  it("serves content-addressed pictures that may be cached for ever", async () => {
    const fetched = await call(`${harness.url}/api/canvas/${id}`);
    const url: string = fetched.body.tiles[0].images.light;

    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /^<svg/);
    assert.match(
      response.headers.get("cache-control") ?? "",
      /immutable/,
      "the hash is in the name, so the bytes can never change",
    );

    // The hash is part of the address, so a wrong one is simply not here.
    const wrong = url.replace(/-[0-9a-f]{32}\.svg$/, "-deadbeefdeadbeefdeadbeefdeadbeef.svg");
    assert.equal((await fetch(wrong)).status, 404);
  });

  it("keeps the API answers out of every cache", async () => {
    for (const path of [`/api/canvas/${id}`, `/c/${id}`]) {
      const response = await fetch(`${harness.url}${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
    }
  });
});

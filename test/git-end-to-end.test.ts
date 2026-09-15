import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { payloadGraph } from "@coldtea/pr-lens-schema/examples";

import { startRemote, type Remote } from "./git-remote.ts";
import { call, start, type Harness } from "./harness.ts";

/**
 * The whole lifecycle from the spec's curl walkthrough, over a git repository.
 * Same assertions as the in-memory run, so the backend is provably an
 * implementation detail rather than a different contract.
 */

const json = { "content-type": "application/json" };

describe("a canvas lifecycle on a git repository", () => {
  let remote: Remote;
  let harness: Harness;

  before(async () => {
    remote = await startRemote();
    harness = await start({
      LOG_REQUESTS: "false",
      STORE: "git",
      GIT_REMOTE: remote.url,
      GIT_MIRROR_DIR: join(remote.scratch, "mirror.git"),
      GIT_BRANCH: "main",
      GIT_PREFIX: "canvases",
    });
  });

  after(async () => {
    await harness.close();
    await remote.close();
  });

  it("mints, pushes, refuses a stale push, fetches, rotates and deletes", async () => {
    const api = `${harness.url}/api/canvas`;

    const minted = await call(api, { method: "POST" });
    assert.equal(minted.status, 201);
    const { id, writeToken } = minted.body;
    const auth = { authorization: `Bearer ${writeToken}` };

    // One file in the repository, and no document in it yet.
    assert.equal((await remote.files()).length, 1);
    assert.equal((await call(`${api}/${id}`)).status, 404);

    const pushed = await call(`${api}/${id}`, {
      method: "PUT",
      headers: { ...json, ...auth, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });
    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.rev, 1);
    assert.ok(pushed.body.tiles.length > 0);

    const stale = await call(`${api}/${id}`, {
      method: "PUT",
      headers: { ...json, ...auth, "if-match": "0" },
      body: JSON.stringify(payloadGraph),
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "REVISION_MOVED");
    assert.equal(stale.body.error.rev, 1);

    const fetched = await call(`${api}/${id}`);
    assert.equal(fetched.body.rev, 1);
    assert.deepEqual(
      fetched.body.document,
      JSON.parse(JSON.stringify(payloadGraph)),
    );

    const next = "Ab3dEf5gHi7jKl9mNo1pQr";
    for (const attempt of [1, 2]) {
      const rotated = await call(`${api}/${id}/rotate`, {
        method: "POST",
        headers: { ...json, ...auth },
        body: JSON.stringify({ writeToken: next }),
      });
      assert.equal(rotated.status, 200, `rotation attempt ${attempt}`);
      assert.equal(rotated.body.editUrl, `${harness.url}/c/${id}#w=${next}`);
    }

    const deleted = await call(`${api}/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${next}` },
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { id, deleted: true });
    assert.deepEqual(
      await remote.files(),
      [],
      "the file is gone from the repository",
    );

    // Every write is a commit, and the log is the canvas's own history --
    // including the revision the API will not serve any more.
    //
    // Not an exact list: a write whose bytes are already there composes the
    // commit that is already there, and pushing it is a no-op rather than an
    // empty commit. The second rotation sets the token it just set, so whether
    // it leaves a fifth commit depends on which second it lands in.
    const log = await remote.log();
    assert.equal(log.at(0), `canvas ${id}: delete`);
    assert.equal(log.at(-1), `canvas ${id}: mint`);
    assert.ok(
      log.filter((subject) => subject === `canvas ${id}: rev 1`).length >= 2,
      `the push and the rotations are in ${JSON.stringify(log)}`,
    );
  });

  it("never writes a token where a copy of the repository would reveal it", async () => {
    const minted = await call(`${harness.url}/api/canvas`, { method: "POST" });
    const { id, writeToken } = minted.body;

    const paths = await remote.files();
    const stored = (
      await Promise.all(paths.map(async (path) => remote.read(path)))
    ).join("\n");

    assert.ok(stored.includes(id), "the id is in the repository");
    assert.ok(
      !stored.includes(writeToken),
      "the token is not, only a hash of it",
    );
    assert.match(stored, /"tokenHash": "sha256:[0-9a-f]{64}"/);
  });
});

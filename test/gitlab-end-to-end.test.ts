import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { payloadGraph } from "@coldtea/pr-lens-schema/examples";

import { startFakeGitLab, type FakeGitLab } from "./fake-gitlab.ts";
import { call, start, type Harness } from "./harness.ts";

/**
 * The whole lifecycle from the spec's curl walkthrough, over a GitLab
 * repository. Same assertions as the in-memory run, so the backend is provably
 * an implementation detail rather than a different contract.
 */

const json = { "content-type": "application/json" };

describe("a canvas lifecycle on a GitLab repository", () => {
  let gitlab: FakeGitLab;
  let harness: Harness;

  before(async () => {
    gitlab = await startFakeGitLab();
    harness = await start({
      LOG_REQUESTS: "false",
      STORE: "gitlab",
      GITLAB_URL: gitlab.baseUrl,
      GITLAB_PROJECT: "group/canvases",
      GITLAB_TOKEN: "glpat-test",
      GITLAB_BRANCH: "main",
      GITLAB_PREFIX: "canvases",
    });
  });

  after(async () => {
    await harness.close();
    await gitlab.close();
  });

  it("mints, pushes, refuses a stale push, fetches, rotates and deletes", async () => {
    const api = `${harness.url}/api/canvas`;

    const minted = await call(api, { method: "POST" });
    assert.equal(minted.status, 201);
    const { id, writeToken } = minted.body;
    const auth = { authorization: `Bearer ${writeToken}` };

    // One file in the repository, and no document in it yet.
    assert.equal(gitlab.files.size, 1);
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
    assert.equal(gitlab.files.size, 0, "the file is gone from the repository");
  });

  it("never writes a token where a copy of the repository would reveal it", async () => {
    const minted = await call(`${harness.url}/api/canvas`, { method: "POST" });
    const { id, writeToken } = minted.body;

    const stored = [...gitlab.files.values()].map((file) => file.content).join("\n");
    assert.ok(stored.includes(id), "the id is in the repository");
    assert.ok(
      !stored.includes(writeToken),
      "the token is not, only a hash of it",
    );
    assert.match(stored, /"tokenHash": "sha256:[0-9a-f]{64}"/);
  });
});

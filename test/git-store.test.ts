import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { payloadGraph } from "@coldtea/pr-lens-schema/examples";

import type { GitSettings } from "../src/config.ts";
import { GitStore } from "../src/store/git.ts";
import {
  StoreThrottled,
  StoreUnavailable,
  type CanvasRecord,
} from "../src/store/types.ts";
import { startRemote, type Remote } from "./git-remote.ts";

/**
 * The git store, against a real repository.
 *
 * The one thing worth proving here is that a push really is the compare-and-swap
 * the revision counter needs: two writers holding the same read both try to
 * write, and exactly one is told it won. Everything else — the layout, the
 * commit messages, the bytes in the file — is the promise that a repository
 * written by the GitLab-API store before it can be picked up by this one with
 * nothing changed but the environment.
 */

const ID = "Qk3vZp9xLm2aRt8yWn4bCg";
const PATH = `canvases/Qk/${ID}.json`;

const recordFor = (id = ID, rev = 0, document?: unknown): CanvasRecord => ({
  id,
  rev,
  tokenHash: "sha256:00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: `2026-01-01T00:00:0${rev}.000Z`,
  document: document ?? (rev === 0 ? null : payloadGraph),
});

/** Exactly the bytes the GitLab-API store put in the repository. */
const asStored = (record: CanvasRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;

describe("the git store", () => {
  let remote: Remote;
  let store: GitStore;

  const settings = (): GitSettings => ({
    remote: remote.url,
    branch: "main",
    prefix: "canvases",
    mirror: join(remote.scratch, "mirror.git"),
    authorName: "pr-lens-gitlab-backend",
    authorEmail: "pr-lens-gitlab-backend@localhost",
    username: "oauth2",
    token: undefined,
    userAgent: "pr-lens-gitlab-backend/9.9.9 (test-host)",
    timeoutMs: 30_000,
    fetchTtlMs: 0,
  });

  beforeEach(async () => {
    remote = await startRemote();
    store = new GitStore(settings());
  });
  afterEach(async () => remote.close());

  it("reads nothing for an id it has never held", async () => {
    assert.equal(await store.read(ID), null);
  });

  it("writes one sharded JSON file per canvas, into an empty repository", async () => {
    assert.equal(await store.create(recordFor()), "written");

    assert.deepEqual(await remote.files(), [PATH]);

    const held = await store.read(ID);
    assert.ok(held !== null);
    assert.deepEqual(held.record, recordFor());
    assert.ok(held.etag.length > 0);
  });

  it("stores the bytes the GitLab store stored, under the messages it used", async () => {
    await store.create(recordFor());
    const held = await store.read(ID);
    assert.ok(held !== null);
    await store.replace(recordFor(ID, 1), held.etag);

    assert.equal(await remote.read(PATH), asStored(recordFor(ID, 1)));
    assert.deepEqual(await remote.log(), [
      `canvas ${ID}: rev 1`,
      `canvas ${ID}: mint`,
    ]);
  });

  it("picks up a repository written before it, and writes on top", async () => {
    // What the GitLab-API store would have left behind: same path, same bytes.
    await remote.seed(PATH, asStored(recordFor()), `canvas ${ID}: mint`);

    const held = await store.read(ID);
    assert.ok(held !== null);
    assert.deepEqual(held.record, recordFor());

    assert.equal(await store.replace(recordFor(ID, 1), held.etag), "written");
    assert.equal((await store.read(ID))?.record.rev, 1);
  });

  it("reports a taken id as a conflict, so a mint can try another", async () => {
    assert.equal(await store.create(recordFor()), "written");
    assert.equal(await store.create(recordFor()), "conflict");
  });

  it("accepts a write whose parent is still the blob the reader saw", async () => {
    await store.create(recordFor());
    const held = await store.read(ID);
    assert.ok(held !== null);

    assert.equal(await store.replace(recordFor(ID, 1), held.etag), "written");

    const after = await store.read(ID);
    assert.equal(after?.record.rev, 1);
    assert.notEqual(after?.etag, held.etag, "a write moves the etag");
  });

  it("refuses two writers holding the same read, and lets exactly one win", async () => {
    await store.create(recordFor());
    const first = await store.read(ID);
    const second = await store.read(ID);
    assert.ok(first !== null && second !== null);
    assert.equal(first.etag, second.etag, "both read the same revision");

    // Different documents, or the two would compose the same commit and the
    // loser's push would be a no-op rather than a refusal.
    const results = await Promise.all([
      store.replace(recordFor(ID, 1, { kind: "graph", who: "first" }), first.etag),
      store.replace(recordFor(ID, 1, { kind: "graph", who: "second" }), second.etag),
    ]);

    assert.deepEqual(results.sort(), ["conflict", "written"]);
    assert.equal((await store.read(ID))?.record.rev, 1);
  });

  it("refuses a delete whose blob has moved", async () => {
    await store.create(recordFor());
    const stale = await store.read(ID);
    assert.ok(stale !== null);
    await store.replace(recordFor(ID, 1), stale.etag);

    assert.equal(await store.remove(ID, stale.etag), "conflict");

    const fresh = await store.read(ID);
    assert.ok(fresh !== null);
    assert.equal(await store.remove(ID, fresh.etag), "written");
    assert.equal(await store.read(ID), null);
    assert.deepEqual(await remote.files(), []);
    assert.equal((await remote.log())[0], `canvas ${ID}: delete`);
  });

  it("retries a push that only lost the branch tip", async () => {
    // Two canvases written at the same instant. One push finds the tip moved,
    // but its own file is untouched, so the write is still good — rebuilt on the
    // new tip and sent again rather than handed back as a conflict.
    const other = "Zz9yXw8vUt7sRq6pOn5mLk";

    const results = await Promise.all([
      store.create(recordFor()),
      store.create(recordFor(other)),
    ]);

    assert.deepEqual(results, ["written", "written"]);
    assert.deepEqual(await remote.files(), [
      PATH,
      `canvases/Zz/${other}.json`,
    ]);
    assert.equal((await remote.log()).length, 2, "one commit each, no more");
  });

  it("sees what another replica wrote, because a read asks the remote", async () => {
    const replica = new GitStore({
      ...settings(),
      mirror: join(remote.scratch, "mirror-two.git"),
    });

    await store.create(recordFor());
    const held = await replica.read(ID);
    assert.ok(held !== null, "the second mirror fetched the first one's commit");
    assert.equal(await replica.create(recordFor()), "conflict");
  });

  it("refuses two replicas holding the same read, mirrors and all", async () => {
    // The same race as above, but across two mirrors that have never heard of
    // each other -- which is what two pods are. Nothing coordinates them: the
    // loser finds out from the remote, on the push.
    const replica = new GitStore({
      ...settings(),
      mirror: join(remote.scratch, "mirror-two.git"),
    });

    await store.create(recordFor());
    const here = await store.read(ID);
    const there = await replica.read(ID);
    assert.ok(here !== null && there !== null);
    assert.equal(here.etag, there.etag, "both replicas read the same revision");

    const results = await Promise.all([
      store.replace(recordFor(ID, 1, { kind: "graph", who: "here" }), here.etag),
      replica.replace(recordFor(ID, 1, { kind: "graph", who: "there" }), there.etag),
    ]);

    assert.deepEqual(results.sort(), ["conflict", "written"]);
    assert.equal((await remote.log()).length, 2, "one write landed, not two");
  });

  it("lands every write when a burst of them arrives at once", async () => {
    // Each write ends at the same branch tip, so a burst contends with itself:
    // one lands per round and the losers compose again. This is the regression
    // guard for the retry budget being too small for that -- which looked like
    // conflicts but was worse, because a write was refused that nobody had
    // raced. Two stores, because a burst in one pod and a burst across two are
    // the same fight over one tip.
    const replica = new GitStore({
      ...settings(),
      mirror: join(remote.scratch, "mirror-two.git"),
    });
    const stores = [store, replica];
    const many = 12;

    const results = await Promise.all(
      Array.from({ length: many }, (_, i) =>
        stores[i % 2]!.create(recordFor(`Zz${String(i).padStart(20, "0")}`)),
      ),
    );

    assert.deepEqual(
      results.filter((result) => result !== "written"),
      [],
      "every write in the burst should have landed",
    );
    assert.equal((await remote.files()).length, many);
  });

  it("gives up on a remote that refuses the push for its own reasons", async () => {
    await remote.refuse("pre-receive hook declined");

    await assert.rejects(
      () => store.create(recordFor()),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("turns the remote's own rate limit into one this server can report", async () => {
    await remote.refuse("HTTP 429 too many requests");

    await assert.rejects(
      () => store.create(recordFor()),
      (error: unknown) => {
        assert.ok(error instanceof StoreThrottled);
        const seconds = (error.retryAt.getTime() - Date.now()) / 1000;
        assert.ok(seconds > 0 && seconds <= 60, `retryAt was ${seconds}s away`);
        return true;
      },
    );
  });

  it("refuses to answer for a file holding a different canvas", async () => {
    await remote.seed(
      PATH,
      asStored(recordFor("AAAAAAAAAAAAAAAAAAAAAA")),
      "a copied file",
    );

    await assert.rejects(
      () => store.read(ID),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("refuses to answer for a file that is not a canvas record", async () => {
    await remote.seed(PATH, "not json at all\n", "something else");

    await assert.rejects(
      () => store.read(ID),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("counts what the branch holds, exactly", async () => {
    assert.deepEqual(await store.count(), { canvases: 0, atLeast: false });

    await store.create(recordFor());
    await store.create(recordFor("Zz9yXw8vUt7sRq6pOn5mLk"));

    assert.deepEqual(await store.count(), { canvases: 2, atLeast: false });
  });

  it("pings the remote, so a bad address fails before a request does", async () => {
    await store.ping();

    const nowhere = new GitStore({
      ...settings(),
      remote: `${remote.url}-does-not-exist`,
      mirror: join(remote.scratch, "mirror-nowhere.git"),
    });
    await assert.rejects(
      () => nowhere.ping(),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("rebuilds a mirror somebody deleted underneath it", async () => {
    await store.create(recordFor());

    // The mirror holds no truth the remote does not, so losing it — a pod
    // moving, an emptyDir going with it — costs a clone and nothing else.
    await rm(join(remote.scratch, "mirror.git"), { recursive: true, force: true });

    assert.equal((await store.read(ID))?.record.rev, 0);
  });
});

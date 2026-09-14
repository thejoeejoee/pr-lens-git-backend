import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { payloadGraph } from "@coldtea/pr-lens-schema/examples";

import type { GitLabSettings } from "../src/config.ts";
import { GitLabStore } from "../src/store/gitlab.ts";
import { StoreThrottled, StoreUnavailable, type CanvasRecord } from "../src/store/types.ts";
import { startFakeGitLab, type FakeGitLab } from "./fake-gitlab.ts";

/**
 * The GitLab store, against a fake GitLab.
 *
 * The one thing worth proving here is that `last_commit_id` really is the
 * compare-and-swap the revision counter needs: two writers holding the same
 * read both try to write, and exactly one is told it won.
 */

const ID = "Qk3vZp9xLm2aRt8yWn4bCg";

const recordFor = (id = ID, rev = 0): CanvasRecord => ({
  id,
  rev,
  tokenHash: "sha256:00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  document: rev === 0 ? null : payloadGraph,
});

describe("the GitLab store", () => {
  let gitlab: FakeGitLab;
  let store: GitLabStore;

  const settings = (): GitLabSettings => ({
    baseUrl: gitlab.baseUrl,
    project: "group/sub/canvases",
    token: "glpat-test",
    branch: "main",
    prefix: "canvases",
    authorName: "pr-lens-gitlab-backend",
    authorEmail: "pr-lens-gitlab-backend@localhost",
    userAgent: "pr-lens-gitlab-backend/9.9.9 (test-host)",
  });

  before(async () => {
    gitlab = await startFakeGitLab();
  });
  after(async () => gitlab.close());

  beforeEach(() => {
    gitlab.files.clear();
    gitlab.branchCollisions = 0;
    gitlab.throttles = 0;
    store = new GitLabStore(settings());
  });

  it("reads nothing for an id it has never held", async () => {
    assert.equal(await store.read(ID), null);
  });

  it("writes one sharded JSON file per canvas", async () => {
    assert.equal(await store.create(recordFor()), "written");

    assert.deepEqual([...gitlab.files.keys()], [`canvases/Qk/${ID}.json`]);

    const held = await store.read(ID);
    assert.ok(held !== null);
    assert.deepEqual(held.record, recordFor());
    assert.ok(held.etag.length > 0);
  });

  it("reports a taken id as a conflict, so a mint can try another", async () => {
    assert.equal(await store.create(recordFor()), "written");
    assert.equal(await store.create(recordFor()), "conflict");
  });

  it("accepts a write whose parent is still the blob's last commit", async () => {
    await store.create(recordFor());
    const held = await store.read(ID);
    assert.ok(held !== null);

    assert.equal(await store.replace(recordFor(ID, 1), held.etag), "written");

    const after_ = await store.read(ID);
    assert.equal(after_?.record.rev, 1);
    assert.notEqual(after_?.etag, held.etag, "a write moves the etag");
  });

  it("refuses two writers holding the same read, and lets exactly one win", async () => {
    await store.create(recordFor());
    const first = await store.read(ID);
    const second = await store.read(ID);
    assert.ok(first !== null && second !== null);
    assert.equal(first.etag, second.etag, "both read the same revision");

    const results = await Promise.all([
      store.replace(recordFor(ID, 1), first.etag),
      store.replace(recordFor(ID, 1), second.etag),
    ]);

    assert.deepEqual(results.sort(), ["conflict", "written"]);
    assert.equal((await store.read(ID))?.record.rev, 1);
  });

  it("refuses a delete whose parent has moved", async () => {
    await store.create(recordFor());
    const stale = await store.read(ID);
    assert.ok(stale !== null);
    await store.replace(recordFor(ID, 1), stale.etag);

    assert.equal(await store.remove(ID, stale.etag), "conflict");

    const fresh = await store.read(ID);
    assert.ok(fresh !== null);
    assert.equal(await store.remove(ID, fresh.etag), "written");
    assert.equal(await store.read(ID), null);
  });

  it("retries a commit that only lost the branch tip", async () => {
    // Two other canvases were written at the same instant. Our own parent is
    // still good, so the same commit is worth sending again.
    gitlab.branchCollisions = 2;
    const before = gitlab.commits;

    assert.equal(await store.create(recordFor()), "written");
    assert.equal(
      gitlab.commits - before,
      1,
      "the retry committed once, not three times",
    );
  });

  it("gives up on a branch that will not settle", async () => {
    gitlab.branchCollisions = 99;
    await assert.rejects(
      () => store.create(recordFor()),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("turns GitLab's own rate limit into one this server can report", async () => {
    gitlab.throttles = 1;
    await assert.rejects(
      () => store.read(ID),
      (error: unknown) => {
        assert.ok(error instanceof StoreThrottled);
        // The fake answers retry-after: 17, so the time is roughly that far off.
        const seconds = (error.retryAt.getTime() - Date.now()) / 1000;
        assert.ok(seconds > 10 && seconds <= 17, `retryAt was ${seconds}s away`);
        return true;
      },
    );
  });

  it("refuses to answer for a file holding a different canvas", async () => {
    gitlab.files.set(`canvases/Qk/${ID}.json`, {
      content: JSON.stringify(recordFor("AAAAAAAAAAAAAAAAAAAAAA")),
      lastCommitId: "abc",
    });

    await assert.rejects(
      () => store.read(ID),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("refuses to answer for a file that is not a canvas record", async () => {
    gitlab.files.set(`canvases/Qk/${ID}.json`, {
      content: "not json at all",
      lastCommitId: "abc",
    });

    await assert.rejects(
      () => store.read(ID),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });

  it("names itself and the instance on every call", async () => {
    await store.read(ID);
    assert.equal(
      gitlab.lastUserAgent,
      "pr-lens-gitlab-backend/9.9.9 (test-host)",
      "GitLab's logs should be able to name the caller",
    );

    await store.create(recordFor());
    assert.equal(gitlab.lastUserAgent, "pr-lens-gitlab-backend/9.9.9 (test-host)");
  });

  it("pings the project, so a bad token fails at startup", async () => {
    await store.ping();

    const wrongProject = new GitLabStore({ ...settings(), project: "" });
    await assert.rejects(
      () => wrongProject.ping(),
      (error: unknown) => error instanceof StoreUnavailable,
    );
  });
});

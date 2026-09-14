# Why GitLab works

A canvas store looks like it needs a database, and mostly it does not. Reading
the contract closely, it needs exactly three things: somewhere to put a document
by id, a hash of a token beside it, and **a compare-and-swap**.

The third one is the whole problem. `If-Match` carries the revision a writer last
saw. Two writers on the same revision both push; one must create the next
revision and the other must be told `REVISION_MOVED`, with nothing changed. Get
that wrong and pushes silently overwrite each other — which is the failure nobody
notices until a diagram is missing a change.

## What GitLab gives away

The Commits API takes a `last_commit_id` per action:

> Last known file commit ID. Only considered in update, move, and delete actions.

GitLab refuses the commit if that is no longer the blob's last commit. That is a
compare-and-swap on a single file, served by an API that is already
authenticated, already audited, and already running somewhere in your
organisation. So:

- read the file, keep its `last_commit_id`
- commit the next revision with that id as the stated parent
- GitLab's refusal *is* `REVISION_MOVED`

No database, no lock, no lease. And a free bonus the contract explicitly does not
offer: every push is a commit, so `git log` over a canvas file is the revision
history, and `git show` is a revision.

## Why not the other GitLab primitives

| | |
| --- | --- |
| **Snippets** | Each is a git repository, so versions exist — but the update API has no CAS. Two concurrent pushes last-write-wins, silently. |
| **Issue notes** | ~1 MB per note against the contract's 4 MB documents, no CAS, JSON hiding in a fenced block, and every push spamming the issue. Charming, unsound. |
| **Generic package registry** | Immutable versions map neatly onto revisions, but `NOT_FOUND` versus conflict gets muddy and deleting every revision of one canvas is awkward. |

## What it costs, and why that is fine

A GitLab API call is 100–300 ms and metered. Two consequences, both handled:

**Writes are one commit each.** Mint, push, rotate, delete. Nothing else writes,
so the commit rate is the push rate, which for diagrams attached to pull requests
is very low.

**Reads are cached in memory** for `READ_CACHE_TTL_MS`, five seconds by default.
This is safe for a reason worth stating, because it is the load-bearing argument
of the whole design: *a stale read is never the basis of a write.* The etag
travels with the read, the store compares it, and a stale etag comes back as a
conflict. The only thing staleness could cost is a conflict reporting the wrong
revision — so a conflict re-reads past the cache before it answers. Everything
else a stale read can do is answer a `GET` five seconds late.

That same argument is why two replicas need no coordination, and why the store
interface is four methods with no transaction in sight.

## The wording problem

One wrinkle, and the reason `test/fake-gitlab.ts` exists. GitLab reports two
different conflicts with the same 400:

- *"You are attempting to update a file that has changed since you started
  editing it"* — the blob moved. A genuine conflict; hand it back.
- *"Could not update refs/heads/main"* — another commit reached the branch tip
  first, but our own parent is still good. Worth retrying, with backoff.

Only the sentence tells them apart. Treat the second as a conflict and every
concurrent write to *any* canvas looks like a revision conflict on *this* one.
The fake GitLab in the tests reproduces both wordings, so that reading is what
the test suite actually checks.

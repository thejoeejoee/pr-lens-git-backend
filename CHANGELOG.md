# Changelog

Kept by [release-please](https://github.com/googleapis/release-please) from the
conventional-commit subjects on `main`. Everything below 0.3.0 was written by
hand, because the two releases before it predate that setup.

## [0.2.0](https://github.com/thejoeejoee/pr-lens-gitlab-backend/compare/v0.1.0...v0.2.0) (2026-09-14)

### Features

* **chart:** offer a Vinyl Cache sidecar, so a deployment gets the CDN half ([328760c](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/328760c))
* **chart:** mount extra volumes, for a self-managed GitLab behind a private CA ([0b7fd91](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/0b7fd91))
* **ci:** publish to npm over OIDC, with no token at all ([09f0c84](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/09f0c84))
* **pkg:** build on install, so npx runs it without a clone ([0dcd51d](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/0dcd51d))

### Bug Fixes

* **release:** hold a local publish to the same checks as a tagged one ([7bcb3bf](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/7bcb3bf))
* **pkg:** ask for provenance in the workflow only, not in package.json ([4456dba](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/4456dba))

### Documentation

* split the guides four ways, after Diataxis ([2f0ed95](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/2f0ed95))
* **readme:** lead with badges, a real render and the CAS sequence ([bddbfb4](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/bddbfb4))

## 0.1.0 (2026-09-14)

### Features

* serve version 1 of the canvas API from a GitLab repository ([c622405](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/c622405))

  The first release: all five canvas routes, the whole error table, the canvas
  page and the content-addressed pictures, with one JSON file per canvas in a
  GitLab repository and `last_commit_id` as the compare-and-swap.

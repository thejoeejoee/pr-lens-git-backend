# Changelog

Kept by [release-please](https://github.com/googleapis/release-please) from the
conventional-commit subjects on `main`. Everything below 0.3.0 was written by
hand, because the two releases before it predate that setup.

## [0.4.0](https://github.com/thejoeejoee/pr-lens-gitlab-backend/compare/v0.3.1...v0.4.0) (2026-09-15)


### Features

* **pages:** a light/dark/auto switcher the reader's browser remembers ([e3476f4](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/e3476f4cb5e10577fb16209c80968a012ed163ee))
* **pages:** a theme switcher, and your own Markdown page at / ([29986bc](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/29986bc0135eafc778ebf30edb4dac5f0f0094d1))
* **pages:** let the mounted page hold HTML, but nothing that executes ([d10f47c](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/d10f47cef9db715307a4511a230f559161a01e2f))
* **pages:** serve a Markdown page of your own at / ([4225fdf](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/4225fdfb92ae5bfc42f6ecc478fc2a457a7dcc4c))


### Bug Fixes

* **gitlab:** retry Gitaly's wording of a lost branch tip ([093806b](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/093806b98ea12ec5ef1d6df98974e0df5b1f86df))
* **gitlab:** retry Gitaly's wording of a lost branch tip ([9ed0cb7](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/9ed0cb7962099d993f1f667d9c85e23acb5dc52a))
* **pages:** close what the review found in the mounted page's rendering ([17fd7ca](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/17fd7ca4b3f66a013c7ffdfe54a387c082ab8fe3))

## [0.3.1](https://github.com/thejoeejoee/pr-lens-gitlab-backend/compare/v0.3.0...v0.3.1) (2026-09-14)


### Bug Fixes

* **ci:** tag releases vX.Y.Z, not &lt;package&gt;-vX.Y.Z ([9cc5de5](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/9cc5de59641522714f5b35d2696d4053de2a97a9))
* **ci:** tag releases vX.Y.Z, not &lt;package&gt;-vX.Y.Z ([ff5821f](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/ff5821f1c06c273d24eafe5c281baaa189e81367))

## [0.3.0](https://github.com/thejoeejoee/pr-lens-gitlab-backend/compare/pr-lens-gitlab-backend-v0.2.0...pr-lens-gitlab-backend-v0.3.0) (2026-09-14)


### Features

* **ci:** let release-please own the version and the changelog ([a1d200a](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/a1d200a5363fb3e870336c8fa7e64a25091c1bcd))
* **ci:** let release-please own the version and the changelog ([0f678ea](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/0f678ea6c836b02990c63b695944fd2f4871de19))
* **gitlab:** name this server and the instance in the User-Agent ([bbdcc0f](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/bbdcc0f7e87d83f8bc2ba13f3fa07a08330cc61e))
* **gitlab:** name this server and the instance in the User-Agent ([bbf473f](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/bbf473fa9ac5cb0f28ef70a6d00170dcc6b321aa))
* **server:** explain the host at /, for whoever pastes it into a browser ([ceb0873](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/ceb08737f90eb7324ffaa543bb65c49ba8a60ad3))


### Bug Fixes

* **ci:** bump appVersion too, and let CI catch it when that fails ([62a72cf](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/62a72cf474e198947b18ad416ec8114fd55055a4))
* **ci:** bump appVersion too, and let CI catch it when that fails ([3f68fea](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/3f68fea6edaffab7fa38ad9c8ea0edbc873ba121))
* **server:** make / a worked example, and say how many canvases are here ([eea48e4](https://github.com/thejoeejoee/pr-lens-gitlab-backend/commit/eea48e42d437ecd311254eae4a7fb58b93d2d118))

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

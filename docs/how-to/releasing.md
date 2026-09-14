# Cut a release

**Merge the release pull request.** That is the whole of it.

[release-please](https://github.com/googleapis/release-please) keeps that PR open
and up to date on every push to `main`, reading the conventional-commit subjects
to work out the next version and to write the changelog. Merging it tags the
release; the tag then publishes three artifacts at one version — the npm package,
the container image, and the Helm chart.

## Configure this once

There are no publishing secrets. npm is reached over OIDC and ghcr with the
built-in `GITHUB_TOKEN`, so nothing in this repository has a credential to leak
or rotate.

### 1. A `release` environment

The `npm` job declares `environment: release`. Create it under
**Settings → Environments → New environment**, named `release`. Empty is fine —
it exists so you can later add a required reviewer and have a publish wait for
one, and npm checks the name as part of the trust below.

Without it the job fails on a missing environment, so this step is not optional.

### 2. npm as a trusted publisher

On the package's **Settings → Trusted Publisher**, with the package already
published once:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `thejoeejoee` |
| Repository | `pr-lens-gitlab-backend` |
| Workflow filename | `release.yml` — filename only, no path |
| Environment name | `release` |
| Allowed actions | publish directly |

npm then trades the workflow's OIDC token for a short-lived publish token. The
trust cannot be edited afterwards, only deleted and recreated, and the three
names above have to keep matching the workflow: rename the job's `environment`,
move the file, or rename the repository, and publishing stops until the trust is
recreated.

### 3. Nothing for the image or the chart

Both push to `ghcr.io` with the built-in `GITHUB_TOKEN`. Two repository settings
they depend on, both defaults:

- **Settings → Actions → General → Workflow permissions**: read-only is correct;
  each job asks for what it needs.
- The first push creates the packages as **private**. Make them public if you
  want anonymous `docker pull` and `helm install`: on each package's page,
  **Package settings → Change visibility**.

### 4. Provenance needs a public repository

`npm publish --provenance` fails on a private repository. This one is public, so
nothing to do — but if you ever make it private, drop the `--provenance` flag
from the workflow at the same time.

Provenance is asked for by that flag and nowhere else, deliberately.
`publishConfig.provenance` in `package.json` would demand it on every publish
including a local one, which cannot produce it: the attestation is signed by the
same CI OIDC token that authorises the publish, so outside CI npm fails with
`Automatic provenance generation not supported for provider: null`.

## What the release PR contains

release-please rewrites four things, so nothing has to be bumped by hand:

| | |
| --- | --- |
| `package.json` + lockfile | the npm version |
| `charts/…/Chart.yaml` | both `version` and `appVersion` — the second is what pins the image the chart installs |
| `docs/how-to/deploy-with-helm.md` | the `--version` in the install example |
| `CHANGELOG.md` | a section per release, grouped by commit type |

The two files it does not own are `release-please-config.json`, which lists the
annotated ones, and `.release-please-manifest.json`, which records where the last
release got to.

## How the version is chosen

From the commit subjects since the last release:

| Subject | Bump |
| --- | --- |
| `fix(…): …` | patch |
| `feat(…): …` | minor |
| `feat(…)!: …`, or `BREAKING CHANGE:` in the body | major |
| `chore`, `ci` | none; hidden from the changelog |
| `docs`, `test`, `refactor`, `perf`, `build` | none; listed in the changelog |

So a release is only offered when something happened that a user would notice. A
run of `chore` commits leaves no PR open, which is the intended answer rather than
a fault.

## The check that still runs

Three places carry the version and nothing publishes unless all three agree — a
chart left behind would let `helm upgrade` succeed and silently install the
previous image. `npm run check:versions` is that check; it runs in `verify` and
again from `prepublishOnly`.

release-please should keep them in step on its own. The check is there for when it
does not: lose one of the `x-release-please-version` annotations and the release
fails loudly instead of shipping a mismatch.

## Chaining, and why it looks indirect

A tag pushed with `GITHUB_TOKEN` does not trigger another workflow. So
`release-please.yml` does not wait for `release.yml` to notice the tag — it
dispatches it:

```yaml
gh workflow run release.yml --ref "$TAG" -f tag="$TAG"
```

Dispatching rather than folding the publish jobs into `release-please.yml` is
also what keeps npm's trusted publisher working: the trust names `release.yml`
and the `release` environment, it cannot be edited after the fact, and a reusable
workflow would change the claim.

## What lands where

| | |
| --- | --- |
| npm | `pr-lens-gitlab-backend`, holding `dist/` only — `prepare` builds it, so the sources never ship |
| image | `ghcr.io/thejoeejoee/pr-lens-gitlab-backend:{version}`, plus `{major}.{minor}`, `{major}` and `latest`, for amd64 and arm64, with a build attestation |
| chart | `oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend:{version}`, also attached to the run as an artifact |

## Re-running one

`workflow_dispatch` takes an existing tag, so a job that failed on a missing
secret can be run again without a new version:

```bash
gh workflow run release.yml -f tag=v0.2.0
```

npm refuses to republish a version that already exists, so a re-run after a
partial release fails on the part that already succeeded. Publish the missing
piece by hand, or bump the patch version.

A `workflow_dispatch` run publishes under the same trust as a tag push: the claim
npm checks is the workflow file and the environment, not what triggered it. Which
is exactly why the chaining above works.

## Releasing without release-please

The tag is still the thing that publishes, so the old path remains open if the
PR is ever in the way:

```bash
gh workflow run release.yml -f tag=v0.3.0
```

Bump `package.json`, both `Chart.yaml` fields and `CHANGELOG.md` yourself first —
`check:versions` will tell you if you miss one — and update
`.release-please-manifest.json` afterwards, or release-please will offer the same
version again.

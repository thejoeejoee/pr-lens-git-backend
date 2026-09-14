# Cut a release

A `v*` tag publishes three things at one version: the npm package, the container
image, and the Helm chart. Four jobs, in
`.github/workflows/release.yml`: `verify` gates the rest, then `npm` and
`container` in parallel, then `chart` once the image it names exists.

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

## Then, for each release

Three files carry the version and `verify` refuses to start unless all three
agree — a chart left behind would silently install the previous image:

```bash
npm version minor --no-git-tag-version     # package.json
# edit charts/pr-lens-gitlab-backend/Chart.yaml: version and appVersion
git commit -am "Release v0.2.0"
git tag v0.2.0
git push --follow-tags
```

Watch it:

```bash
gh run watch --exit-status
```

## What lands where

| | |
| --- | --- |
| npm | `pr-lens-gitlab-backend`, holding `dist/` only — `prepare` builds it, so the sources never ship |
| image | `ghcr.io/thejoeejoee/pr-lens-gitlab-backend:{version}`, plus `{major}.{minor}`, `{major}` and `latest`, for amd64 and arm64, with a build attestation |
| chart | `oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend:{version}`, also attached to the run as an artifact |

## Publishing by hand

The workflow is the supported path. A local publish still works and is how
`0.1.0` got to the registry in the first place — a trusted publisher can only be
configured on a package that already exists — but it cannot be signed:

```bash
npm publish --access public
```

The tarball is identical; it simply arrives without a provenance attestation, so
npm shows no link back to the commit it was built from. It also skips `verify`,
so nothing checks that `package.json` and the chart agree on the version.

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
npm checks is the workflow file and the environment, not what triggered it.

# Cut a release

A `v*` tag publishes three things at one version: the npm package, the container
image, and the Helm chart. Four jobs, in
`.github/workflows/release.yml`: `verify` gates the rest, then `npm` and
`container` in parallel, then `chart` once the image it names exists.

## Configure this once

### 1. `NPM_TOKEN`

The only secret you have to add. In npm, **Access Tokens → Generate → Granular**,
with write access to `pr-lens-gitlab-backend`, then in GitHub under
**Settings → Secrets and variables → Actions**:

```
NPM_TOKEN = npm_…
```

A classic **Automation** token works too; what matters is that it bypasses 2FA,
because the workflow cannot answer an OTP prompt.

### 2. A `release` environment

The `npm` job declares `environment: release`. Create it under
**Settings → Environments → New environment**, named `release`. Empty is fine —
it exists so you can later add a required reviewer and have a publish wait for
one.

Without it the job fails on a missing environment, so this step is not optional.

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
including a local one, which cannot produce it: provenance is signed by a CI
provider's OIDC token, so outside CI npm fails with
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

The workflow is the supported path, but nothing stops a local publish — it just
cannot be signed:

```bash
npm publish --access public
```

The tarball is identical; it simply arrives without a provenance attestation, so
npm shows no link back to the commit it was built from. Worth it to unblock a
first release, worth undoing afterwards.

## Re-running one

`workflow_dispatch` takes an existing tag, so a job that failed on a missing
secret can be run again without a new version:

```bash
gh workflow run release.yml -f tag=v0.2.0
```

npm refuses to republish a version that already exists, so a re-run after a
partial release fails on the part that already succeeded. Publish the missing
piece by hand, or bump the patch version.

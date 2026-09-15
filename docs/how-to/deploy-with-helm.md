# Deploy with Helm

The chart is an OCI artifact beside the image. It renders a Deployment, a Service
and one route — no ServiceAccount, no HPA, no PodDisruptionBudget.

Optionally it also renders a cache sidecar: `cache.enabled=true` puts Vinyl Cache
in the pod and points the Service at it. See
[put a CDN in front](put-a-cdn-in-front.md#the-cache-sidecar).

## Make the Secret first

The chart deliberately creates none: a token belongs to whatever manages your
secrets, not to a chart release. Every key in the Secret arrives as an
environment variable.

```bash
kubectl create secret generic pr-lens-gitlab \
  --from-literal=GITLAB_TOKEN=glpat-…
```

## Install

<!-- x-release-please-start-version -->
```bash
helm install lens oci://ghcr.io/thejoeejoee/charts/pr-lens-gitlab-backend \
  --version 0.4.0 \
  --set secretName=pr-lens-gitlab \
  --set config.gitlab.project=platform/pr-lens-canvases \
  --set config.publicUrl=https://lens.example.com \
  --set ingress.enabled=true \
  --set ingress.host=lens.example.com
```
<!-- x-release-please-end -->

For Gateway API instead of an Ingress:

```bash
  --set httpRoute.enabled=true \
  --set httpRoute.hostnames[0]=lens.example.com \
  --set httpRoute.parentRefs[0].name=my-gateway
```

Leave both off and nothing is exposed; `kubectl port-forward` still works.

## Set publicUrl

Without it, every answer names whichever host the request arrived on. Behind an
ingress that is usually right, but anything that rewrites `Host` will send the
CLI's edit links to the wrong place. Set it once and stop thinking about it.

## Two replicas is the default

The server holds nothing that cannot be rebuilt, so a second replica costs a
little memory and buys a rolling restart with no downtime. The two things that
are per-pod rather than shared:

- the rate limiters, so the effective limit is `replicas × the number you set`
- the read cache, so one pod can be up to `READ_CACHE_TTL_MS` behind another

Neither can corrupt anything — see
[Why GitLab works](../explanation/why-gitlab.md) for why a stale read is safe.

## Say what this host is, in your own words

The page at `/` explains PR Lens to a stranger. For a host your own team uses,
what belongs there is usually which project is behind it and who to ask. One
value replaces the whole page:

````yaml
config:
  indexMarkdown: |
    # Platform canvases

    Diagrams for the payments group. Ask in #platform-eng.

    ```sh
    export PR_LENS_API_URL={{origin}}
    ```
````

It becomes a ConfigMap mounted at `/etc/pr-lens/index.md`, and the server re-reads
it when it changes — so `kubectl edit configmap <release>-index` is the whole
deployment, with no rollout. `{{origin}}` and four other placeholders are filled
in; [Configuration](../reference/configuration.md#your-own-page-at-) lists them,
and says which HTML that page may hold: everything except what executes.

## Probes

`/healthz` is liveness and asks only whether the process is up. `/readyz` is
readiness and asks GitLab, so an unreachable GitLab takes pods out of the Service
without restarting them in a loop.

`charts/pr-lens-gitlab-backend/values.yaml` documents every setting.

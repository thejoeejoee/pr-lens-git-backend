{{/* The chart's own name, overridable. */}}
{{- define "pr-lens-gitlab-backend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pr-lens-gitlab-backend.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
A name for one of the release's own resources, as `<fullname>-<suffix>`.

fullname is already truncated to the 63 characters a Kubernetes name may have,
so appending to it would take the result past what the API server accepts. The
room the suffix needs comes off the base instead -- truncating afterwards would
be worse than failing, since two suffixes would come back as the same name.
*/}}
{{- define "pr-lens-gitlab-backend.suffixed" -}}
{{- $room := int (sub 62 (len .suffix)) -}}
{{- printf "%s-%s" (include "pr-lens-gitlab-backend.fullname" .root | trunc $room | trimSuffix "-") .suffix -}}
{{- end -}}

{{- define "pr-lens-gitlab-backend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pr-lens-gitlab-backend.labels" -}}
helm.sh/chart: {{ include "pr-lens-gitlab-backend.chart" . }}
{{ include "pr-lens-gitlab-backend.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "pr-lens-gitlab-backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pr-lens-gitlab-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
The hosts the Ingress answers on, comma-joined so that one definition can serve
both the rules and NOTES.txt -- a template may only return a string, and
`splitList` at the call site turns this back into a list.

`hosts` is the list; `host` is what the chart has always taken and still does,
as the single-host spelling of the same thing. Setting both is not an error: the
list wins, because a list is the more explicit of the two.
*/}}
{{- define "pr-lens-gitlab-backend.ingressHosts" -}}
{{- if .Values.ingress.hosts -}}
{{- join "," .Values.ingress.hosts -}}
{{- else -}}
{{- required "ingress.host or ingress.hosts is required when the ingress is enabled" .Values.ingress.host -}}
{{- end -}}
{{- end -}}

{{/*
The settings, as environment. Written here rather than in a ConfigMap so that
the whole configuration of a pod is one thing to read.

Numbers go through int64 before quoting, or Helm renders a large one in
scientific notation and the server is handed "4e+06" to parse. extraEnv goes
through `nindent 0` rather than a bare `toYaml`, or the trim markers glue its
first entry onto the line above.
*/}}
{{- define "pr-lens-gitlab-backend.env" -}}
- name: PORT
  value: "8787"
- name: HOST
  value: "0.0.0.0"
- name: STORE
  value: {{ .Values.config.store | quote }}
{{- with .Values.config.publicUrl }}
- name: PUBLIC_URL
  value: {{ . | quote }}
{{- end }}
{{- if eq .Values.config.store "git" }}
- name: GIT_REMOTE
  value: {{ required "config.git.remote is required when config.store is git" .Values.config.git.remote | quote }}
- name: GIT_BRANCH
  value: {{ .Values.config.git.branch | quote }}
- name: GIT_PREFIX
  value: {{ .Values.config.git.prefix | quote }}
- name: GIT_AUTHOR_NAME
  value: {{ .Values.config.git.authorName | quote }}
- name: GIT_AUTHOR_EMAIL
  value: {{ .Values.config.git.authorEmail | quote }}
- name: GIT_USERNAME
  value: {{ .Values.config.git.username | quote }}
- name: GIT_MIRROR_DIR
  value: {{ .Values.config.git.mirrorDir | quote }}
- name: GIT_FETCH_TTL_MS
  value: {{ .Values.config.git.fetchTtlMs | int64 | quote }}
- name: GIT_TIMEOUT_MS
  value: {{ .Values.config.git.timeoutMs | int64 | quote }}
{{- end }}
- name: MAX_BODY_BYTES
  value: {{ .Values.config.maxBodyBytes | int64 | quote }}
- name: READ_CACHE_TTL_MS
  value: {{ .Values.config.readCacheTtlMs | int64 | quote }}
- name: RENDER_CACHE_BYTES
  value: {{ .Values.config.renderCacheBytes | int64 | quote }}
- name: DRAW
  value: {{ .Values.config.draw | quote }}
- name: MINTS_PER_HOUR_PER_IP
  value: {{ .Values.config.mintsPerHourPerIp | int64 | quote }}
- name: PUSHES_PER_MINUTE_PER_CANVAS
  value: {{ .Values.config.pushesPerMinutePerCanvas | int64 | quote }}
- name: IMAGE_CACHE_CONTROL
  value: {{ .Values.config.imageCacheControl | quote }}
- name: EMBED_CACHE_CONTROL
  value: {{ .Values.config.embedCacheControl | quote }}
- name: TRUST_PROXY
  value: {{ .Values.config.trustProxy | quote }}
- name: LOG_REQUESTS
  value: {{ .Values.config.logRequests | quote }}
- name: INDEX_PAGE
  value: {{ .Values.config.indexPage | quote }}
{{- if .Values.config.indexMarkdown }}
- name: INDEX_MARKDOWN_FILE
  value: /etc/pr-lens/index.md
{{- end }}
{{- with .Values.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}

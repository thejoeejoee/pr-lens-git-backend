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
{{- if eq .Values.config.store "gitlab" }}
- name: GITLAB_URL
  value: {{ .Values.config.gitlab.url | quote }}
- name: GITLAB_PROJECT
  value: {{ required "config.gitlab.project is required when config.store is gitlab" .Values.config.gitlab.project | quote }}
- name: GITLAB_BRANCH
  value: {{ .Values.config.gitlab.branch | quote }}
- name: GITLAB_PREFIX
  value: {{ .Values.config.gitlab.prefix | quote }}
- name: GITLAB_AUTHOR_NAME
  value: {{ .Values.config.gitlab.authorName | quote }}
- name: GITLAB_AUTHOR_EMAIL
  value: {{ .Values.config.gitlab.authorEmail | quote }}
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
{{- with .Values.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}

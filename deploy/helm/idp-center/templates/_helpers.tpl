{{- define "idp-center.name" -}}
idp-center
{{- end -}}

{{- define "idp-center.fullname" -}}
{{- .Release.Name -}}-idp-center
{{- end -}}

{{- define "idp-center.labels" -}}
app.kubernetes.io/name: {{ include "idp-center.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "idp-center.selectorLabels" -}}
app.kubernetes.io/name: {{ include "idp-center.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "idp-center.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "idp-center.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "idp-center.secretName" -}}
{{- .Values.secret.existingSecret | default (printf "%s-secret" (include "idp-center.fullname" .)) -}}
{{- end -}}

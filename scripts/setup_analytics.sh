#!/usr/bin/env bash
# One-time setup of funnel analytics in a Google Cloud project (safe to re-run).
#   scripts/setup_analytics.sh <funnel-dir>
# Creates the BigQuery dataset, a Cloud Logging sink that copies "funnel_event" log lines from every Cloud Run
# service in the project into it, and the roles the sink and the Cloud Run runtime account need. One setup per
# project serves every funnel in it; /analytics on each service filters by its own funnel name.
set -euo pipefail
dir="${1:?usage: $0 <funnel-dir>}"; dir="${dir%/}"
cfg() { python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); v=c
for k in sys.argv[2].split("."): v=(v or {}).get(k)
print(v if isinstance(v,str) else "")' "$dir/funnel.config.json" "$1"; }

project="${PROJECT:-$(cfg gcp.project)}"
dataset="${ANALYTICS_DATASET:-$(cfg analytics.dataset)}"; dataset="${dataset:-funnel_analytics}"
location="${ANALYTICS_LOCATION:-US}"
sink="funnel-events"
[ -n "$project" ] || { echo "set gcp.project in $dir/funnel.config.json or PROJECT"; exit 1; }

gcloud services enable bigquery.googleapis.com logging.googleapis.com --project "$project" --quiet

if ! bq --project_id "$project" show --format=none "$project:$dataset" 2>/dev/null; then
  bq --project_id "$project" mk --location "$location" --dataset --description "Funnel events from Cloud Logging" "$project:$dataset"
fi

filter='resource.type="cloud_run_revision" AND jsonPayload.kind="funnel_event"'
dest="bigquery.googleapis.com/projects/$project/datasets/$dataset"
if gcloud logging sinks describe "$sink" --project "$project" >/dev/null 2>&1; then
  gcloud logging sinks update "$sink" "$dest" --log-filter "$filter" --project "$project" --quiet
else
  gcloud logging sinks create "$sink" "$dest" --log-filter "$filter" --use-partitioned-tables --project "$project" --quiet
fi
writer="$(gcloud logging sinks describe "$sink" --project "$project" --format 'value(writerIdentity)')"

# Cloud Run services run as the default compute account unless the service sets another one.
number="$(gcloud projects describe "$project" --format 'value(projectNumber)')"
runtime="${RUNTIME_SA:-$number-compute@developer.gserviceaccount.com}"
bind() { gcloud projects add-iam-policy-binding "$project" --member "$1" --role "$2" --condition None --quiet >/dev/null; }
bind "$writer" roles/bigquery.dataEditor
bind "serviceAccount:$runtime" roles/bigquery.dataViewer
bind "serviceAccount:$runtime" roles/bigquery.jobUser

echo "analytics: dataset $project:$dataset, sink $sink, reader $runtime"
echo "next: set ANALYTICS_PASSWORD for the service (Secret Manager), deploy, open <service url>/analytics"

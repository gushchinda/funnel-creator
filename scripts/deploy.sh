#!/usr/bin/env bash
# Deploy one or more funnel folders to Cloud Run.
#   scripts/deploy.sh <funnel-dir> [<funnel-dir> ...]
# Reads gcp.project / region / service / auth_env / secrets from <dir>/funnel.config.json (PROJECT and REGION env
# vars override), env vars from <dir>/.env. Keys listed in gcp.secrets go through Secret Manager instead.
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: $0 <funnel-dir> [...]"; exit 1; }

cfg() { python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); v=c
for k in sys.argv[2].split("."): v=(v or {}).get(k)
print(v if isinstance(v,str) else json.dumps(v) if v else "")' "$1/funnel.config.json" "$2"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for dir in "$@"; do
  dir="${dir%/}"
  project="${PROJECT:-$(cfg "$dir" gcp.project)}"
  region="${REGION:-$(cfg "$dir" gcp.region)}"; region="${region:-us-central1}"
  service="$(cfg "$dir" gcp.service)"; service="${service:-$(basename "$dir")}"
  auth_env="$(cfg "$dir" gcp.auth_env)"
  [ -n "$project" ] || { echo "$dir: set gcp.project in funnel.config.json or PROJECT"; exit 1; }

  # Service account key from an env var, if one is named and set. Some sandboxes pre-set an access token that
  # would override it, so drop that first.
  if [ -n "$auth_env" ] && [ -n "${!auth_env:-}" ]; then
    unset CLOUDSDK_AUTH_ACCESS_TOKEN
    printf '%s' "${!auth_env}" > "$TMP/key.json"
    gcloud auth activate-service-account --key-file "$TMP/key.json" --quiet >/dev/null
    rm -f "$TMP/key.json"
  fi

  # .env -> env-vars YAML (skipping empty values, tool-only keys and Secret Manager keys) + --set-secrets list.
  secrets="$(python3 - "$dir" "$TMP/env.yaml" <<'PY'
import json, pathlib, sys
d = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
sm = (json.loads((d / "funnel.config.json").read_text()).get("gcp") or {}).get("secrets") or {}
skip = {"FAL_KEY", "FAL_KEY_SECRET", "GCLOUD_KEY_JSON", "PORT"} | set(sm)
lines = []
envf = d / ".env"
for raw in (envf.read_text().splitlines() if envf.exists() else []):
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    v = v.strip().strip('"').strip("'")
    if v and k not in skip:
        lines.append(f"{k}: {json.dumps(v)}")
out.write_text("\n".join(lines) + "\n")
print(",".join(f"{k}={name}:latest" for k, name in sm.items()))
PY
)"

  echo "== $service ($project, $region)"
  gcloud run deploy "$service" --source "$dir" --project "$project" --region "$region" \
    --env-vars-file "$TMP/env.yaml" ${secrets:+--set-secrets "$secrets"} \
    --allow-unauthenticated --quiet
  echo "$service: $(gcloud run services describe "$service" --project "$project" --region "$region" --format='value(status.url)')"
done

#!/usr/bin/env bash
# Refuse to commit or share files that look like they contain secrets.
#   scripts/check_secrets.sh <path> [<path> ...]     exit 1 and list matches if anything is found
# Checks file contents (keys, tokens, private keys) and file names (.env, service account keys).
set -uo pipefail
[ $# -gt 0 ] || set -- .

PATTERNS=(
  'sk_(live|test)_[0-9A-Za-z]{10,}'            # Stripe secret key
  'rk_(live|test)_[0-9A-Za-z]{10,}'            # Stripe restricted key
  'whsec_[0-9A-Za-z]{10,}'                     # Stripe webhook secret
  'pdl_(live|sdbx)_apikey_[0-9A-Za-z_]{10,}'   # Paddle API key
  'pdl_ntfset_[0-9A-Za-z_]{10,}'               # Paddle notification secret
  'EAA[0-9A-Za-z]{30,}'                        # Meta access token
  '"private_key": *"-----BEGIN'                # Google service account key
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'  # any private key
  'AIza[0-9A-Za-z_-]{35}'                      # Google API key
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}'  # fal.ai key
  're_[0-9A-Za-z]{8,}_[0-9A-Za-z]{16,}'         # Resend API key
  'SG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}'    # SendGrid API key
  'secret_live_[0-9A-Za-z._-]{20,}'            # Adapty secret key
  'sk_[0-9A-Za-z]{26,}'                        # RevenueCat secret key
)

found=0
for p in "$@"; do
  hits="$(grep -rInE --exclude-dir=node_modules --exclude-dir=.git "$(IFS='|'; echo "${PATTERNS[*]}")" "$p" 2>/dev/null | cut -c1-160)"
  [ -n "$hits" ] && { echo "$hits"; found=1; }
  files="$(find "$p" \( -name node_modules -o -name .git \) -prune -o -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*-key.json' -o -name 'env.yaml' \) ! -name '.env.example' -print 2>/dev/null)"
  if [ -n "$files" ] && git -C "$(dirname "$p")" rev-parse >/dev/null 2>&1; then
    tracked="$(echo "$files" | xargs git ls-files 2>/dev/null)"
    [ -n "$tracked" ] && { echo "tracked secret files:"; echo "$tracked"; found=1; }
  fi
done

if [ "$found" = 1 ]; then echo "check_secrets: possible secrets found, remove them before committing or sharing"; exit 1; fi
echo "check_secrets: clean"

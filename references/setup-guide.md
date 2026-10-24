# Guided setup: accounts and keys, step by step

Use this when the user does not have something from Blocks B–C of `first-run.md` yet, or says "walk me through
it". The user may be non-technical: lead them one small step at a time.

## How to guide

- **One account per message**, in this order: Google Cloud → Stripe or Paddle → Meta Pixel → fal.ai (optional).
  Skip what the user already has.
- Each message: what this is for (one line), numbered clicks with direct links, what the user should end up with,
  and "write **готово** / **done** when you have it". Wait. Then the next account.
- Never ask the user to paste a key into chat. They copy each value into a private note (Notes app, password
  manager) and, at the end, put **all** of them into environment variables at once (last section). In cloud
  sessions new variables only reach a **new** session, so collecting first saves restarts.
- If the user pastes a key anyway: use it, do not repeat it back, never write it to a tracked file, and suggest
  rotating it after the launch.
- After the variables are set, **verify each one** (commands below) and report ✅ / ❌ per item. On ❌ say exactly
  which step to redo.
- Talk in the user's language. Screens and menu names change: if the user cannot find a button, ask for a
  screenshot and guide from it.

## 1. Google Cloud (hosting the funnel)

What they end up with: a project ID and a service-account key file (JSON).

1. Open https://console.cloud.google.com/ and sign in with a Google account.
2. Top bar → project picker → **New project**. Name it, e.g. `funnels`. Write down the **Project ID** shown under
   the name (it can differ from the name).
3. Billing: https://console.cloud.google.com/billing → link a billing account to the project. Cloud Run has a free
   tier, but a card is required.
4. Enable the APIs (one link, then **Enable**):
   `https://console.cloud.google.com/flows/enableapi?apiid=run.googleapis.com,cloudbuild.googleapis.com,artifactregistry.googleapis.com,secretmanager.googleapis.com&project=<PROJECT_ID>`
5. Service account: https://console.cloud.google.com/iam-admin/serviceaccounts?project=<PROJECT_ID> →
   **Create service account** → name `claude-deployer` → **Create and continue** → add roles:
   Cloud Run Admin, Cloud Build Editor, Service Account User, Artifact Registry Writer, Storage Admin,
   Service Usage Consumer, Secret Manager Admin → **Done**.
6. Open the new account → **Keys** → **Add key** → **Create new key** → **JSON** → a file downloads. Its whole
   contents is the value of `GCLOUD_KEY_JSON`. Keep the file private.
7. Region: default `us-central1` (supports custom domains on Cloud Run).

Verify (after the variables are set):

```bash
unset CLOUDSDK_AUTH_ACCESS_TOKEN
printf '%s' "$GCLOUD_KEY_JSON" > "$TMPDIR/gcloud-key.json"
gcloud auth activate-service-account --key-file "$TMPDIR/gcloud-key.json"
gcloud run services list --project <PROJECT_ID> --region us-central1   # empty list = OK
```

## 2a. Stripe (payments)

What they end up with: test publishable and secret keys.

1. Open https://dashboard.stripe.com/ (create an account if needed; activation for live payments can wait).
2. Switch on **Test mode** (toggle top right, or open https://dashboard.stripe.com/test/apikeys).
3. **Developers → API keys**: copy **Publishable key** (`pk_test_…`) → `STRIPE_PUBLISHABLE_KEY`;
   **Secret key** → **Reveal** → copy (`sk_test_…`) → `STRIPE_SECRET_KEY`.
4. The webhook secret is created later by `scripts/setup_stripe.mjs`; nothing to do now.
5. Later, for live: the same page without Test mode, after the account is activated. Ask before switching.

Verify: `curl -s https://api.stripe.com/v1/balance -u "$STRIPE_SECRET_KEY:" | head -c 200` → JSON with
`"object": "balance"` and `"livemode": false`.

## 2b. Paddle (payments, alternative)

1. Sandbox account: https://sandbox-vendors.paddle.com/signup (live: https://vendors.paddle.com).
2. **Developer tools → Authentication**: create an **API key** → `PADDLE_API_KEY`; create a **client-side token**
   → `PADDLE_CLIENT_TOKEN`. Set `PADDLE_ENV=sandbox`.
3. For live checkout Paddle must approve the funnel's domain (Checkout → Website approval) — after the domain is
   connected.

Verify: `curl -s https://sandbox-api.paddle.com/products -H "Authorization: Bearer $PADDLE_API_KEY" | head -c 200`
→ JSON with `"data"`.

## 3. Meta Pixel and Conversions API (ad tracking)

What they end up with: Pixel ID, CAPI access token, test event code.

1. Open https://business.facebook.com/events_manager2 (needs a Meta Business portfolio; create one if asked).
2. **Connect data sources → Web → Connect** → name it (product name) → skip the website-install wizard. Copy the
   **Pixel ID / Dataset ID** (digits) → `META_PIXEL_ID`.
3. Pixel → **Settings** → **Conversions API** → **Generate access token** → copy → `META_CAPI_TOKEN`.
4. Pixel → **Test events** tab → copy the **test code** (like `TEST12345`) → `META_TEST_EVENT_CODE`.
5. If the client runs the ads from their own Business account, they create the pixel there and share it with the
   user's business (Business settings → Data sources → Datasets → Assign partners).

Verify: `curl -s "https://graph.facebook.com/v21.0/$META_PIXEL_ID?fields=id,name&access_token=$META_CAPI_TOKEN"`
→ JSON with the pixel `id`. An error about permissions means the token was generated for another pixel.

## 4. fal.ai (new photos, optional)

1. https://fal.ai/dashboard/keys → sign in → **Add key** → copy the **whole** key (`<id>:<secret>`) → `FAL_KEY`.
2. Add credit in Billing (a funnel's photos cost a few dollars).

Verify: `curl -s -o /dev/null -w '%{http_code}' https://queue.fal.run/fal-ai/flux/schnell -H "Authorization: Key $FAL_KEY" -H 'Content-Type: application/json' -d '{"prompt":"test"}'`
→ `200`. `401` means the key is cut or wrong.

## 5. Putting the values in

Tell the user where, depending on where the skill runs:

- **Claude Code on the web / cloud sessions:** environment settings → **Environment variables**, one
  `NAME=value` per line. For `GCLOUD_KEY_JSON` paste the whole JSON on one line. Then open a **new** session
  (variables load at start) and say "continue": the skill resumes from `funnel.config.json`.
  Also make sure the environment's network access allows the competitor's site and the APIs above (full access
  is simplest).
- **Claude Code on the user's computer:** a `.env` file in the funnel folder (gitignored), or `export NAME=value`
  in the shell before starting Claude.
- **Claude apps without a shell:** the skill cannot deploy from there; suggest running it in Claude Code.

The full list, so the user can tick it off:

```
GCLOUD_KEY_JSON=        # whole JSON key
STRIPE_SECRET_KEY=      # sk_test_…        (or PADDLE_API_KEY, PADDLE_CLIENT_TOKEN, PADDLE_ENV=sandbox)
STRIPE_PUBLISHABLE_KEY= # pk_test_…
META_PIXEL_ID=
META_CAPI_TOKEN=
META_TEST_EVENT_CODE=
FAL_KEY=                # optional
```

Record the project ID, region and the variable **names** in `funnel.config.json`, then run all the checks and
send one ✅/❌ list.

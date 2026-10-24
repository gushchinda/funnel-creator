# Phase 8: test deploy to Google Cloud Run

Every funnel is deployed to the user's Cloud Run before hand-off, with test payment keys and the Meta test event
code, so the user (and the app developer) can walk and pay through it.

## Authenticate

- If `gcloud` is already logged in to the right account, use it.
- If a service account key is in an env var (name in `funnel.config.json → gcp.auth_env`): write it to a temp file
  outside the repo, `gcloud auth activate-service-account --key-file <file>`, delete the file right after, and pass
  `--project <id>` on every command.
- Some sandboxes pre-set `CLOUDSDK_AUTH_ACCESS_TOKEN`, which silently overrides the service account. `unset` it if
  `gcloud auth list` shows a different account than expected.
- First deploy in a project: enable `run.googleapis.com`, `cloudbuild.googleapis.com`,
  `artifactregistry.googleapis.com` (and `secretmanager.googleapis.com` if used). Ask the user if the account
  lacks permission; give them the exact role to add.

## Deploy

```bash
scripts/deploy.sh <funnel-folder> [<funnel-folder> ...]
```

For each folder it builds from source (`gcloud run deploy <service> --source <folder> --region <region>
--allow-unauthenticated`), sets env vars from `<folder>/.env` (or from Secret Manager references listed in
`funnel.config.json`), and prints the service URL. Service name = folder name.

- Payment keys for live go to Secret Manager (`--set-secrets STRIPE_SECRET_KEY=<secret>:latest`); test keys may be
  plain env vars on the test service.
- Generate `TOKEN_SECRET`, `ACCESS_TOKEN_SECRET`, `FUNNEL_API_KEY`, `APP_WEBHOOK_SECRET` with
  `openssl rand -base64 32` once per funnel and keep them in `.env` / Secret Manager. Changing them later breaks
  pay links in flight, issued access tokens, or the app integration respectively.
- `--min-instances 0` for tests; suggest `1` for live paid traffic to avoid cold starts on the first screen.
- Some sandboxes cannot reach `*.run.app`. Then verify through Cloud Logging and ask the user to open the URL, or
  use a browser tool on the user's machine.

## After the first deploy

1. Create the payment webhook for the service URL (`setup_stripe.mjs --webhook …` or `setup_paddle.mjs --webhook
   …`), put the secret in env, redeploy.
2. Stripe: register the `run.app` host in Payment method domains so wallets show up.
3. Update `funnel.config.json → status.test_url` and the developer spec's test base URL.

## Smoke test (all must pass)

On a 375×812 viewport, from the landing URL with `?utm_source=test`:
- every step renders and matches its reference screenshot; back button works; reload resumes;
- email step fires `CompleteRegistration` (browser + server) in Test events;
- paywall: timer runs, each plan shows the right today/renewal prices, CTA opens `/pay/<token>`;
- test payment succeeds; 3-D Secure card succeeds and returns to the thank-you step;
- `Purchase` arrives from browser and server, deduplicated, with value;
- the provider shows the customer and subscription with funnel metadata;
- `GET /v1/subscription?email=<test email>` returns `has_access: true`; `/v1/me` works with the token from the
  thank-you link; `/manage/<token>` opens the provider page;
- `/health` is `ok` (not `/healthz`: run.app answers that path itself with a 404); logs show no errors.

Save clone screenshots of every step to `report/clone/` during this pass.

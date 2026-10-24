# Questions after the reference, the clone plan, and where answers go

Ask these **after** the user has seen the captured reference (phase 1), never before. Ask one block per message,
at most five numbered questions, each with a default the user can accept with "ok". Pre-fill defaults from the
reference (plan structure, currency, language, timer, guarantee). Questions marked ● block the build; ○ can arrive
later: build with a placeholder and list them as open in the report. Skip any question the user already answered.

## Block A — what to clone (send together with the screen sheet)

1. ● Anything missing from the screens? Clone 1:1, or skip / add / reorder steps? (Default: 1:1.)
2. ● Is the reference the user's own funnel? (Decides whether its copy and images can be reused. Default: no.)
3. ● Language of the clone. (Default: the reference's language.)
4. ● App name and one-line description; funnel slug (default: `<app>-<reference>`, lowercase, dashes).
5. ● Where buyers go after paying: App Store / Google Play links, or a deep link / universal link scheme.

## Block B — offer and payments

1. ● Stripe or Paddle? (Default: the provider the reference uses, else Stripe.)
2. ● Plans: billing period, renewal price, intro price or trial, currency. Default: the reference's structure,
   e.g. "3 plans like theirs: $X today, then $Y every N weeks — confirm or change the prices".
3. ● Paywall mechanics: discount timer, struck-through prices, money-back guarantee, upsells. Default: as in the
   reference; a guarantee is only promised if the user confirms they honour it.
4. ● Existing price / product IDs to reuse, or create new ones with `scripts/setup_stripe.mjs` / `setup_paddle.mjs`?
5. ● Names of the env vars holding the keys (values go into the environment, not chat):
   - Stripe: `STRIPE_SECRET_KEY` (or a restricted key with write access to Customers, Subscriptions, Invoices,
     Checkout/Billing Portal, Webhook Endpoints), `STRIPE_PUBLISHABLE_KEY`. Test keys first.
   - Paddle: `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_ENV` (`sandbox` or `production`). The webhook secret
     is created by the setup script. Paddle needs the funnel domain approved for live checkout.

## Block C — tracking, images, hosting

1. ● `META_PIXEL_ID`, `META_CAPI_TOKEN` (Events Manager → Settings → Conversions API → Generate access token).
2. ● `META_TEST_EVENT_CODE` for the test deploy (Events Manager → Test events).
3. ○ `FAL_KEY` for fal.ai (or another image API). Without it the clone uses neutral placeholders and the report
   lists photos as open.
4. ● Google Cloud project ID and region (default `us-central1`), and how this session authenticates: an existing
   `gcloud` login, or a service account key in an env var (for example `GCLOUD_KEY_JSON`). Roles it needs: Cloud
   Run Admin, Cloud Build Editor, Service Account User, Artifact Registry Writer, Storage Admin, Service Usage
   Consumer, and Secret Manager Admin if secrets go there.
5. ○ Logo (SVG or PNG), brand colour, font; legal pages (privacy, terms, subscription terms, support email —
   required before live launch). Default: keep the reference's visual system, swap logo and name.

## Block D — app integration

1. ● How the app identifies a buyer: by **email** (user types it in the app) or by an **app user id** (the app opens
   the funnel with `?uid=<id>`, or the app is installed after purchase and receives a token by deep link).
2. ● Does the app have its own backend? If yes, the backend calls the subscription API with the server key and can
   receive push webhooks. If no, the app uses the per-user access token flow.
3. ○ Who integrates on the app side (name / contact), so the spec can be addressed to them.

## After the answers

1. Write `funnel.config.json` (schema below) and `.env.example`. Add `.env` to `.gitignore`.
2. Fill `templates/developer-spec.md` into `docs/developer-spec.md` with the funnel's base URL placeholder,
   provider, identity mode and plan ids. Send it to the user with one line: "forward this to your app developer".
3. **Clone plan (phase 3).** Show the user, in one message or page: a table `reference step → clone step → what
   changes` for every step, the paywall (plans, prices, timer, guarantee), and the pixel events with the step
   that fires each. Ask "build it?". Start phase 4 only after the user says go.

## Where secrets go

| Where | What |
|---|---|
| Session environment variables | Everything, when the platform supports it (preferred). |
| `<funnel>/.env` | Local runs. Gitignored. Never attached or quoted. |
| Cloud Run env vars / Secret Manager | Deployed service. Use Secret Manager for live payment keys. |
| `funnel.config.json` | Only env var **names**, never values. |

If a key is missing when needed, say which one, where to get it, and where to put it; keep working on everything
that does not need it.

## `funnel.config.json`

`slug` is this funnel (folder and Cloud Run service name); `source` is the product-level tag shared by all of a
product's funnels, written on every payment object. Amounts are in minor units; `period` is `<n><d|w|m|y>`;
`intro` is `none`, `first_invoice_discount` or `trial_<n>d_plus_fee`. `gcp.secrets` maps env vars to Secret Manager
secret names for the deploy.

```json
{
  "slug": "acme-sleep-men",
  "source": "acme-funnels",
  "language": "en",
  "reference": {
    "url": "https://example.com/quiz",
    "name": "Example Sleep quiz",
    "owned_by_user": false,
    "changes": ["skip step 14 (newsletter opt-in)"]
  },
  "product": {
    "name": "Acme Sleep",
    "after_purchase": {
      "ios": "https://apps.apple.com/app/id0000000000",
      "android": "https://play.google.com/store/apps/details?id=com.example.app",
      "deep_link": "acmesleep://funnel-success"
    },
    "legal": { "privacy": "", "terms": "", "support_email": "" }
  },
  "payments": {
    "provider": "stripe",
    "currency": "usd",
    "plans": [
      { "id": "week",  "label": "1-week plan",  "terms": "$4.99 today, then $44 every 4 weeks",
        "today": 499,  "renew": 4400, "period": "4w",  "intro": "trial_7d_plus_fee" },
      { "id": "month", "label": "4-week plan",  "terms": "$9.99 today, then $44 every 4 weeks",
        "today": 999,  "renew": 4400, "period": "4w",  "intro": "first_invoice_discount" },
      { "id": "year",  "label": "12-week plan", "terms": "$19.99 today, then $79 every 12 weeks",
        "today": 1999, "renew": 7900, "period": "12w", "intro": "first_invoice_discount" }
    ],
    "env": { "secret": "STRIPE_SECRET_KEY", "publishable": "STRIPE_PUBLISHABLE_KEY", "webhook_secret": "STRIPE_WEBHOOK_SECRET" }
  },
  "meta": { "env": { "pixel_id": "META_PIXEL_ID", "capi_token": "META_CAPI_TOKEN", "test_code": "META_TEST_EVENT_CODE" } },
  "images": { "provider": "fal", "env": "FAL_KEY" },
  "gcp": { "project": "my-gcp-project", "region": "us-central1", "service": "acme-sleep-men", "auth_env": "GCLOUD_KEY_JSON",
           "secrets": { "STRIPE_SECRET_KEY": "acme-stripe-secret-key" } },
  "app": { "identity": "email", "has_backend": true, "developer_contact": "" },
  "status": { "phase": 0, "test_url": "", "open_items": [] }
}
```

Update `status` at the end of every phase so the next run knows where to continue.

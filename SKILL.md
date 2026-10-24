---
name: funnel-cloner
description: Clone a reference web-to-app subscription funnel (quiz, onboarding, paywall) step by step and design for design, take payments with Stripe or Paddle, send Meta Pixel + Conversions API events, send a welcome email after purchase, hand purchases to the app's subscription service (Adapty, RevenueCat, Apphud), expose a subscription-status API for the mobile app, track every step in a built-in analytics dashboard, and deploy to Google Cloud Run. Works as a guided dialogue that starts by capturing and showing the competitor's funnel. Use when someone asks to copy, clone, rebuild or "make a funnel like" an existing quiz or paywall funnel.
---

# Funnel cloner

Builds a production web funnel for a subscription app by reproducing a **reference funnel** as closely as possible:
every step in the same order, the same layouts and interactions, the same paywall mechanics. Brand, photos and copy
become the user's own. The result is a small Node server plus a static front end, deployed to the user's Google
Cloud Run, with:

- payments through **Stripe** (on-site Payment Element) or **Paddle** (Paddle.js inline checkout);
- **Meta Pixel + Conversions API**: `CompleteRegistration` and `Purchase` (plus `InitiateCheckout`), browser and
  server with a shared `event_id` so Meta deduplicates them;
- a **welcome email** after the first payment (Resend, Postmark or SendGrid) with an "Open the app" button,
  the plan, and a manage-subscription link;
- the purchase handed to the app's **subscription service** (Adapty, RevenueCat or Apphud) on the right user, so
  the app unlocks through its usual SDK check;
- a **subscription status API** the mobile app calls to unlock access, and a spec for the app developer;
- **funnel analytics**: every step, email, checkout and purchase per session, in BigQuery, with a
  password-protected dashboard at `/analytics` (conversion by step, plan and traffic source);
- a delivery report with screenshots of reference vs clone, and step-by-step domain instructions.

Everything specific to a user lives in their project folder and environment, never in this skill.

The references, templates and scripts named below live in https://github.com/gushchinda/funnel-creator. If they
are not next to this file, clone that repository (default branch) and work from the clone.

## How to work

Run the phases in order. Each phase has a reference file; read it when you reach the phase, not before.

| # | Phase | Read | Output |
|---|---|---|---|
| 0 | Ask for the reference funnel | this file, below | reference URL, funnel slug |
| 1 | Capture the reference and **show it to the user** | `references/reference-capture.md` | `<funnel>/reference/` screenshots, texts, tokens, `flow.md`, screen sheet |
| 2 | Questions, step by step | `references/first-run.md` | `<funnel>/funnel.config.json`, `.env.example`, developer spec draft |
| 3 | Plan of the clone, approved by the user | `references/first-run.md` (end) | step table: reference step → clone step → changes |
| 4 | Build the clone | `references/build.md` | `<funnel>/web/`, `<funnel>/server/` from `templates/` |
| 5 | Payments | `references/stripe.md` or `references/paddle.md` | products/prices, checkout, webhook |
| 6 | Pixel + CAPI | `references/meta-capi.md` | events verified in Test Events |
| 7 | Subscription API, app service, welcome email, app spec | `references/subscription-api.md`, `references/app-services.md`, `references/email.md` | `/v1/*` endpoints, service hand-off, welcome email, `<funnel>/docs/developer-spec.md` |
| 8 | Test deploy to Cloud Run + analytics | `references/deploy.md`, `references/analytics.md` | live test URL, smoke test passed (welcome email received, purchase in the app's service), `/analytics` shows the test walk |
| 9 | Hand-off | `references/handoff.md` | report with screenshots, domain instructions |

Keep a checklist of these phases visible to the user and update it as you go.

## How the conversation goes

The skill is a guided dialogue. The user should never face a wall of questions before seeing anything.

1. **First message: ask only for the reference.** "Send me the link to the competitor funnel you want to clone
   (the first screen of the quiz). If you already know, add your app's name." Nothing else.
2. **Show the reference before asking anything more.** Capture it (phase 1) and show the user a screen sheet:
   every step as a thumbnail with its number and type, plus a 5–8 line summary: number of steps, the blocks
   (questions → social proof → loader → email → paywall), the paywall model (plans, prices, timer, guarantee),
   payment provider and pixel events the reference uses. Publish the sheet as a page if the platform has one,
   otherwise attach the images. Then ask whether anything is missing and whether to clone 1:1 or adapt.
3. **Then the questions, one block per message**, in the order of `references/first-run.md`. At most five
   questions per message, numbered, each with a default the user can accept by answering "ok". Pre-fill defaults
   from what the reference showed (plan structure, currency, language, timer). Wait for the answer before the
   next block. When the user lacks an account or key (Google Cloud, Stripe/Paddle, Meta Pixel, fal.ai, email
   service), guide them through creating it step by step with `references/setup-guide.md`, then verify each key.
4. **Plan for approval.** Before writing code, show the clone plan: a table of steps (reference step → clone
   step → what changes), the paywall, the pixel events. Build only after the user says go.
5. **Build, test deploy, hand-off** as in the phase table. After the test deploy, send the link and ask the user
   to walk it on their phone; then send the report and the domain instructions.

Keep the phase checklist visible and update it after every phase.

**Later runs.** A run is a first run when the funnel folder has no `funnel.config.json`. Otherwise read it and
`status` in it, and continue from the first unfinished phase. Do not ask again what is already recorded.

**Secrets.** Ask the user to put keys into environment variables or the funnel's `.env` (gitignored), not into
chat. If they paste a key anyway, use it, do not repeat it back, and never write it into any tracked file,
report, screenshot or commit. Record in `funnel.config.json` only the **names** of the env vars.

As soon as the payment provider and app identity are known, fill `templates/developer-spec.md` into
`<funnel>/docs/developer-spec.md` and give it to the user: the app developer can start integrating while the funnel
is being built.

## Rules that always apply

**Layout of the work.** Each funnel lives in its own folder at the root of the user's funnels repository:

```
<funnel-slug>/
  funnel.config.json     answers from the first run, no secrets
  .env.example           variable names only; .env itself is gitignored
  reference/             what the reference funnel looks like (phase 1)
  web/                   static front end: steps, styles, images, bridge script
  server/                Node server: static hosting, payments, CAPI, subscription API
  docs/                  developer-spec.md, STRIPE.md or PADDLE.md
  report/                delivery report and domain instructions (phase 9)
  Dockerfile
```

Several variants of one funnel (for example men/women, or different first screens) share code through a
`<product>-common/` folder and get one folder each, so each deploys as its own Cloud Run service.

**Clone faithfully, rebrand completely.**
- Same steps, same order, same question types, same number of options, same interstitials, loaders, charts,
  social proof blocks, timers and paywall structure. When in doubt, match the reference.
- Match the visual system: fonts (or the closest free font), colour palette, spacing, corner radii, button styles,
  progress bar, transitions. Check side by side at 375×812 before calling a step done.
- Replace everything that belongs to the reference's owner: name, logo, photos, illustrations, testimonials,
  claims and statistics. Rewrite copy for the user's product; do not ship the reference's text verbatim, and do not
  invent medical, scientific or earnings claims. Generate new photos (`scripts/gen_images.py`).
- If the reference funnel belongs to the user (their own funnel on another stack), copying its assets and copy is
  fine; record that in `funnel.config.json` (`reference.owned_by_user: true`).

**Language.** Funnels are built in the language of the reference unless the user asks otherwise. Talk to the user
in the language they write in.

**Payments.**
- Test mode first: Stripe test keys / Paddle sandbox on the test deploy. Switch to live only when the user says so.
- If the only keys you have are live keys, say so before any test payment: a "test" purchase will take real money.
- Tag every object the funnel creates with `source = <funnel-slug>` in metadata / custom data, plus `funnel_session`,
  `plan`, and `app_user_id` when known. That is how the subscription API and the user find them.
- The server confirms payment (webhook or provider API) before it sends `Purchase` or grants access. Never trust a
  success URL alone.

**Pixel.** Every funnel sends `CompleteRegistration` (email entered) and `Purchase` (first payment confirmed),
browser and server, same `event_id`. Details and verification in `references/meta-capi.md`.

**Never in git, reports or chat:** API keys, webhook secrets, CAPI tokens, service account keys, admin passwords,
customer emails. Run `scripts/check_secrets.sh <funnel>` before every commit and before sharing a report.

**After the purchase.** Every funnel sends the welcome email (`references/email.md`) unless the user turns it off,
and always asks which subscription service the app uses (Adapty, RevenueCat, Apphud, other, own backend). With a
service, the purchase must land on the same user id the app gives that service's SDK (`references/app-services.md`).
Connecting Stripe inside the service (its app or webhook) creates objects in the user's Stripe account: the user
does it, or approves it first.

**Analytics.** Every funnel tracks every step (`FunnelBridge.track`) and ships the `/analytics` dashboard. Run
`scripts/setup_analytics.sh` once per Google Cloud project and keep the dashboard password in Secret Manager.
Hand the user the dashboard link with the test deploy.

**Deploy.** Every funnel gets a test deploy to the user's Cloud Run before hand-off. The hand-off always includes
step-by-step domain mapping instructions written for a non-technical person (`templates/domain-instructions.md`).

**Report the reference.** The hand-off names the reference funnel and shows reference and clone side by side,
step by step (`references/handoff.md`).

## Files in this skill

```
SKILL.md                         this file
references/
  first-run.md                   questions, config schema, where secrets go
  setup-guide.md                 step-by-step help to create Google Cloud, Stripe/Paddle, Meta, fal.ai, email keys
  reference-capture.md           walking the reference funnel, what to record
  build.md                       front end and server structure, design matching, images, variants
  stripe.md                      products, intro prices, Payment Element flow, webhook
  paddle.md                      products, intro discounts, Paddle.js inline checkout, webhook
  meta-capi.md                   events, dedup, user_data, Test Events check
  subscription-api.md            endpoints, access rules, linking purchases to app users
  app-services.md                Adapty / RevenueCat / Apphud: user id, metadata, server call, dashboard steps
  email.md                       welcome email: provider, sender domain, contents, once-only sending
  deploy.md                      Cloud Run deploy, env and secrets, smoke test
  analytics.md                   funnel events, BigQuery sink, /analytics dashboard
  handoff.md                     report, screenshots, domain instructions, final checklist
templates/
  funnel.config.example.json
  env.example
  developer-spec.md              spec for the app developer (filled per funnel)
  domain-instructions.md         domain mapping guide for the client
  server/                        Express server: payments, CAPI, subscription API, analytics + dashboard,
                                 welcome email (lib/email.js, emails/), app service hand-off (lib/app-service.js)
  web/funnel-bridge.js           session, pixel events, checkout start (include in every page)
  web/pay-stripe.html            on-site Stripe payment page
  web/pay-paddle.html            Paddle inline checkout page
  Dockerfile
scripts/
  capture_reference.mjs          Playwright walk of the reference: screenshots, text, styles, network
  gen_images.py                  photo generation (fal.ai)
  setup_stripe.mjs               create products, prices, coupons, webhook endpoint
  setup_paddle.mjs               create products, prices, discounts, notification destination
  deploy.sh                      Cloud Run deploy of one or more funnel folders
  setup_analytics.sh             BigQuery dataset + log sink + roles for funnel analytics (once per project)
  send_test_email.mjs            send the welcome email once, without a purchase, to check key, sender and layout
  check_secrets.sh               refuse to commit or share anything that looks like a key
```

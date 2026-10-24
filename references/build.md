# Phase 4: build the clone

## Two ways to build

**A. Rebuild (default).** The reference belongs to someone else, or its code is not available. Build a static
front end from `reference/flow.md` and `tokens.json`. Below.

**B. Patch the original bundle.** The reference is the user's own funnel and its built JS bundle is available
(for example they own the site, or gave you the build). Copy the original into `<funnel>/original/`, and write a
`patch.py` that applies string replacements to produce `web/`. Rules that made this work:
- every replacement asserts the exact number of matches, so a new upstream build fails loudly instead of shipping
  half-patched;
- point the bundle's API base at the same origin and emulate the endpoints it calls in `server/`;
- never edit the generated output by hand, only `patch.py`;
- variants (different first screens, men/women) are a VARIANT section in each folder's `patch.py` that calls a
  shared `build()` in `<product>-common/`.

## Front end (rebuild)

```
web/
  index.html          shell: fonts, styles, pixel base code, funnel-bridge.js, app.js
  steps.json          the flow: one object per step, generated from reference/flow.md
  app.js              renderer: one component per step type, router, state, transitions
  styles.css          tokens as CSS variables, then components
  images/             generated photos and icons (no reference assets unless owned_by_user)
  pay.html            copy of templates/web/pay-stripe.html or pay-paddle.html
  funnel-bridge.js    copy of templates/web/funnel-bridge.js (do not fork; configure via window.FUNNEL)
```

Plain HTML/CSS/JS with no build step is preferred: it deploys anywhere, loads fast on mobile and is easy to diff
against the reference. Use a framework only if the reference's interactions really need one.

`steps.json` entries:

```json
{ "id": "age", "type": "image-single", "progress": true,
  "title": "What's your age?", "subtitle": "We use it to personalise your plan",
  "options": [ {"id": "18-29", "label": "18–29", "image": "images/age-18-29.webp"} ],
  "store": "age", "next": "auto" }
```

Renderer rules:
- State lives in `sessionStorage` under one key (`<slug>.state`): answers, session id, current step, plan,
  email. Reloading the page resumes on the same step.
- `?step=<id>` jumps to a step with demo answers, for QA and screenshots. `?go=paywall` is an alias.
- Capture `utm_*`, `fbclid` (store it as the `_fbc` cookie value `fb.1.<ms>.<fbclid>` if no `_fbc` exists), and
  `uid` (app user id) from the landing URL into state; they go into checkout metadata.
- Personalised copy and charts read answers from state, never from the reference's numbers.
- Paywall timer starts when the paywall first renders and persists across reloads; when it ends, follow the
  reference (prices go up, or the discount badge disappears).
- Set `window.FUNNEL = { slug: "<funnel slug>" }` before loading the bridge, and keep quiz answers in
  `FunnelBridge.save({ answers })` so they reach the lead log.
- Call `FunnelBridge.track('step_view', { step: step.id, index })` after every step render, and set
  `FunnelBridge.save({ demo: true })` when `?step=` fills demo answers (see `references/analytics.md`).
- Call the bridge at the two moments that matter:
  `FunnelBridge.registration(email)` when the email step is submitted, and
  `FunnelBridge.checkout(planId)` when the paywall CTA is pressed. The bridge handles pixel, CAPI and redirect.
  The thank-you step (`?step=thank-you`) needs nothing extra: the bridge fires `Purchase` from the `paid`
  parameter; its "Open the app" button uses `FunnelBridge.appLink(<deep link>)`, with store links as fallback.
- Accessibility basics: real buttons, labels on inputs, visible focus, 16px minimum input font (no iOS zoom).

## Matching the design

Work step by step. For each step: build it, open `?step=<id>` at 375×812, screenshot it with Playwright into
`report/clone/NN-<slug>.png`, and compare with `reference/steps/NN-<slug>.png`. Fix spacing, sizes and colours
until the two look like the same product family at a glance. Also check 360×640 (small Android) and 430×932:
buttons must stay above the fold on the small screen when the reference keeps them there.

## Images

`scripts/gen_images.py --spec <funnel>/web/images.json` generates every photo listed in the spec with fal.ai
(FLUX). The spec gives each image a file name, size and prompt. Prompt rules that worked:
- one shared style line for the whole funnel (light, palette, background) so the set looks consistent;
- for age tiles: same framing and backdrop for every tile, only age changes;
- match the audience of the variant (a men's funnel shows men);
- "no text, no logos" on everything; no brand-name devices (watches, phones).
Without an image key, use neutral placeholders and list photos as open. Never reuse the reference's photos unless
`owned_by_user` is true.

## Server

Copy `templates/server/` to `<funnel>/server/` and `templates/Dockerfile` to `<funnel>/`, then `npm install` in
`server/`. Plans are read from `funnel.config.json`; provider ids from `server/provider-ids.json`, which the setup
scripts write. The server:
- serves `web/` (long cache for hashed assets, `no-cache` for HTML);
- `POST /api/registration` → CAPI `CompleteRegistration` (and logs the lead with quiz answers);
- `POST /api/checkout` → signed pay token, CAPI `InitiateCheckout`, returns the pay page URL;
- Stripe or Paddle routes and webhook (chosen by `PAYMENT_PROVIDER`);
- `/v1/*` subscription API for the app;
- `POST /api/events` and the `/analytics` dashboard (`references/analytics.md`);
- `/health` (also `/healthz`, which run.app swallows at its front end).

Do not add a database unless the funnel needs one: subscription state is read from the payment provider, and
quiz answers are logged as structured JSON (Cloud Logging) and attached to the provider's metadata.

## Variants

One folder per variant (`<slug>-men`, `<slug>-women`), shared code in `<product>-common/`, one Cloud Run service
each. Every Stripe/Paddle object and every CAPI event carries `funnel: <variant>` so results can be compared.

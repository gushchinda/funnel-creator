# Handing purchases to the app's subscription service

Many apps do not check access themselves: an SDK (Adapty, RevenueCat, Apphud, Qonversion…) decides whether the
user is premium. Then the web purchase must show up **in that service, on the same user**, or the app will not
unlock. Ask at first run (Block D, question 4) and set `app.service` in `funnel.config.json`.

The funnel's own `/v1/subscription` and `/v1/me` API keep working in every case; the service integration is in
addition to it, not instead.

## The user id

The service attaches the purchase to the id the app passes to its SDK (`Adapty.identify`, `Purchases.logIn`,
`Apphud.start(userID:)`). The funnel must know that id at payment time:

- **uid** (default, `APP_USER_ID_FROM=uid`): the app opens the funnel with `?uid=<that id>`. Works when the
  user starts in the app.
- **email** (`APP_USER_ID_FROM=email`): only when the app itself identifies users by their email in the SDK
  (lowercased). Works for people who come from ads and install later, which is the usual web-to-app case.
- **neither**: the service cannot link the purchase by itself. The app then uses the funnel API (access token
  from the deep link or welcome email, `GET /v1/me`) and grants access, or its backend calls the service. Say
  this in the developer spec.

Pick with the user and record it as `app.user_id_from`.

## Adapty (`APP_SERVICE=adapty`)

Docs: https://adapty.io/docs/stripe and https://adapty.io/docs/api-adapty/operations/validateStripePurchase.md

What the funnel does:
- writes `customer_user_id` into the Stripe customer and subscription metadata;
- after the first payment calls `POST https://api.adapty.io/api/v1/sdk/purchase/stripe/token/validate/` with
  `Authorization: Api-Key <ADAPTY_SECRET_KEY>`, body `{data: {type: "stripe_receipt_validation_result",
  attributes: {customer_user_id, stripe_token: "sub_…"}}}`. The purchase appears on that profile at once.

What the user does in Adapty (guide them; you cannot do it without their login):
1. App settings → General → API keys: copy the **secret** key into `ADAPTY_SECRET_KEY` (env / Secret Manager).
2. App settings → Stripe: connect Stripe, either by installing the Adapty app from the Stripe App Marketplace
   (creates the webhook itself) or with a restricted key plus a webhook endpoint to the URL Adapty shows. Use
   Stripe **test mode** keys for testing; Adapty does not support Stripe Sandboxes. Profile creation behaviour:
   "Use customer_user_id from metadata".
3. Products: add every Stripe `prod_…` + `price_…` pair the funnel uses (from `server/provider-ids.json`).
   Coupon-based intro prices are fine; trial + one-off fee plans record the subscription price.
4. Access levels: link those products to the access level the app checks.

Both the Adapty app install and a manual webhook create objects in the user's Stripe account: ask before doing
it, and never do it when the user said not to touch their Stripe setup.

## RevenueCat (`APP_SERVICE=revenuecat`)

Docs: https://www.revenuecat.com/docs/web/integrations/stripe/track-external-purchases

What the funnel does: writes `app_user_id` into metadata and, after the first payment, calls
`POST https://api.revenuecat.com/v1/receipts` with `X-Platform: stripe`,
`Authorization: Bearer <REVENUECAT_STRIPE_PUBLIC_KEY>`, body `{app_user_id, fetch_token: "sub_…"}`.

What the user does: in the RevenueCat project add the Stripe app (connect the Stripe account), copy the Stripe
app's **public** API key into `REVENUECAT_STRIPE_PUBLIC_KEY`, add the Stripe products and attach them to the
entitlement and offering. Optional: Stripe server notifications for renewals and cancellations (RevenueCat also
polls Stripe).

## Apphud (`APP_SERVICE=apphud`)

Docs: https://docs.apphud.com/docs/stripe

What the funnel does: writes `apphud_user_id` (and `apphud_client_id` if `APPHUD_CLIENT_ID` is set, needed when
one Stripe account serves several Apphud apps) into the Stripe **customer** metadata. Apphud reads it through its
Stripe integration; there is no server call.

What the user does: Apphud → Settings → Web → Payment Providers → Stripe, follow the steps, then add the Stripe
product and price ids to the Product Hub.

## Paddle

The services that support Paddle read the user id from the transaction's `custom_data`, which the funnel fills
with the same keys. There is no server call for Paddle; connect Paddle in the service's dashboard.

## Other services or the app's own backend (`APP_SERVICE=none`)

Qonversion, Superwall, Glassfy, an in-house backend: check the service's current web/Stripe docs at first run.
If it reads Stripe metadata, add its key to `meta()` in `lib/app-service.js`; if it has a validate endpoint, add
it to `CALLS`. Otherwise the app backend uses the push webhook (`APP_WEBHOOK_URL`) or `GET /v1/subscription`.

## Verify (phase 8)

1. Test purchase with a known user id (`?uid=test-user-1` or the email).
2. Log line `{"kind":"app_service_synced"}`; on errors `app_service_error` with the service's answer.
3. In the service dashboard, the profile with that id shows the subscription and the access level (Adapty and
   RevenueCat show Stripe test purchases as sandbox).
4. Put a screenshot of the profile in the report.

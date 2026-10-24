# Phase 5 (Stripe): on-site subscription payment

The buyer pays on the funnel's own `/pay/<token>` page with Stripe's Payment Element (cards, Apple Pay, Google Pay,
Link). No redirect to a hosted checkout, which keeps the funnel's look up to the last screen.

## Products and prices

Model every plan as **one recurring price at the renewal amount** and make the first payment cheaper with a
discount. The subscription then has one price forever and needs no Subscription Schedule.

| Intro model | How | Example |
|---|---|---|
| `first_invoice_discount` | renewal price + coupon `duration: once` worth (renew − today) | $44/4 weeks, coupon −$34.01 → $9.99 today |
| `trial_7d_plus_fee` | renewal price + `trial_period_days` + one-off `add_invoice_items` for today's amount | $4.99 today, $44 after 7 days |
| `none` | renewal price only | $29.99/month |

`scripts/setup_stripe.mjs <funnel>/funnel.config.json` creates (or finds, by `lookup_key` and coupon id) the
product, prices and coupons, prints the ids, and writes them into `server/plans.js`. Before going further, check
each plan's first invoice with `stripe.invoices.createPreview` and compare with the paywall: the amounts must match
to the cent.

## Flow

1. Paywall CTA → bridge `POST /api/checkout {plan, email, session_id, fbp, fbc, uid, page_url}`. The server answers
   `{url: "/pay/<token>"}`; the token is HMAC-signed with `TOKEN_SECRET`, holds plan/email/session/uid, lives 48 h.
2. `/pay/<token>` mounts the Payment Element in deferred mode (`mode: 'subscription'`, amount = today's price), so
   nothing is created in Stripe until the buyer presses Pay.
3. Pay → `POST /api/stripe/subscribe/<token>`: creates Customer (email, metadata) and Subscription with
   `payment_behavior: 'default_incomplete'`, `payment_settings.save_default_payment_method: 'on_subscription'`,
   metadata, expand `latest_invoice.confirmation_secret`. One subscription per token: a retry reuses the incomplete
   one instead of stacking new ones.
4. Front end calls `stripe.confirmPayment({ clientSecret, redirect: 'if_required' })`. 3-D Secure and wallet
   redirects come back to `/pay/<token>/return`.
5. `POST /api/stripe/complete/<token>` polls the subscription for up to ~6 s until `latest_invoice.status === 'paid'`
   and status is `active` or `trialing`, then redirects to the thank-you step with `?paid=<subscription id>`.
6. **Webhook** `/webhooks/stripe` is the source of truth: on `invoice.paid` with `billing_reason =
   subscription_create` it sends CAPI `Purchase` (event_id `purchase_<subscription id>`) and pushes the app
   webhook. Also handles `customer.subscription.updated|deleted` (app push only).

Metadata on Customer and Subscription: `source=<slug>`, `funnel=<variant>`, `funnel_session`, `plan`, `uid`
(if known), `utm_source`, `utm_campaign`.

## Webhook endpoint

`setup_stripe.mjs --webhook https://<service-url>/webhooks/stripe` creates the endpoint with events
`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` and
prints the signing secret once; store it as `STRIPE_WEBHOOK_SECRET`. Rerun with the final domain after the domain
is mapped, and delete the endpoint for the temporary URL afterwards. Do not touch webhook endpoints the account
already has.

## Apple Pay / Google Pay

Register every domain the pay page is served from in Stripe → Settings → Payment method domains (or
`stripe.paymentMethodDomains.create`), including the temporary `run.app` URL for the test. Apple Pay also needs
`/.well-known/apple-developer-merchantid-domain-association` served from the domain: download it from Stripe and
put it in `web/.well-known/`.

## Customer self-service

`/manage/<access token>` creates a Billing Portal session and redirects. Enable the portal once in the Stripe
dashboard (cancel at period end, update payment method). The thank-you email or app links there.

## Test cards

`4242 4242 4242 4242` success; `4000 0027 6000 3184` 3-D Secure; `4000 0000 0000 9995` declined. Any future date,
any CVC.

## Write `docs/STRIPE.md`

Product, price and coupon ids with what each one is, the three intro models used, metadata keys, webhook URL and
events, and how to find all funnel subscriptions (Subscriptions → filter metadata `source`).

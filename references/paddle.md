# Phase 5 (Paddle): inline checkout with Paddle Billing

Paddle is merchant of record: it collects tax, handles invoices and refunds, and the checkout form is Paddle's.
The funnel embeds it **inline** on `/pay/<token>`, styled to match the funnel, so the buyer stays on the page.
This covers Paddle Billing (API v1, ids like `pri_…`, `ctm_…`, `sub_…`, `txn_…`), not Paddle Classic.

## Account setup (once per Paddle account)

- Sandbox account for the test deploy, live account for launch. `PADDLE_ENV=sandbox|production` switches the API
  base (`https://sandbox-api.paddle.com` / `https://api.paddle.com`) and Paddle.js environment.
- `PADDLE_API_KEY` (server; permissions: products, prices, discounts, customers, subscriptions, transactions,
  notification settings — read and write).
- `PADDLE_CLIENT_TOKEN` (`test_…` / `live_…`, safe to expose in the page).
- Checkout settings → **default payment link**: must be set (the funnel URL is fine) or checkouts will not open.
- Live only: the funnel domain must be **approved** by Paddle (Checkout → Website approval). Submit it as soon as
  the domain is known; approval can take days. Legal pages (terms, privacy, refund policy) must be live on it.

## Products, prices, intro offers

`scripts/setup_paddle.mjs <funnel>/funnel.config.json` creates (or finds by `custom_data.funnel_plan`) one product,
one recurring price per plan at the renewal amount (`billing_cycle` e.g. `{interval: "week", frequency: 4}`), and
one discount per intro offer, then writes the ids into `server/plans.js`.

| Intro model | How in Paddle |
|---|---|
| `first_invoice_discount` | discount `type: flat`, `amount` = renew − today, `currency_code`, `recur: false`, `restrict_to: [price id]`, `enabled_for_checkout: true`; pass `discountId` when opening the checkout |
| `trial_7d_plus_fee` | price with `trial_period: {interval: "day", frequency: 7}` plus a one-time price for the fee in the same checkout. **Verify in sandbox** that the fee is charged today; if not, use a first-invoice discount instead and tell the user the offer changed |
| `none` | recurring price only |

Prices in Paddle are tax-inclusive or exclusive per price (`tax_mode`). Match what the paywall shows: for a
US-style "$9.99 today" use `tax_mode: "account_setting"` with the account set to exclusive, or decide with the
user. Check each plan by opening the sandbox checkout and reading today's total.

## Flow

1. Paywall CTA → bridge `POST /api/checkout` → `{url: "/pay/<token>"}` (same signed token as Stripe).
2. `/pay/<token>` loads `https://cdn.paddle.com/paddle/v2/paddle.js`, then:
   ```js
   if (cfg.env === 'sandbox') Paddle.Environment.set('sandbox');
   Paddle.Initialize({ token: cfg.clientToken, eventCallback: onPaddleEvent });
   Paddle.Checkout.open({
     items: cfg.items,                       // [{ priceId, quantity: 1 }, ...]
     discountId: cfg.discountId || undefined,
     customer: { email: cfg.email },
     customData: cfg.customData,             // source, funnel, funnel_session, plan, uid, utm_*
     settings: { displayMode: 'inline', frameTarget: 'paddle-frame', frameInitialHeight: 450,
                 frameStyle: 'width:100%; min-width:312px; background:transparent; border:none;',
                 variant: 'one-page', locale: cfg.locale, theme: 'light', allowLogout: false,
                 showAddDiscounts: false, successUrl: cfg.successUrl }
   });
   ```
3. `checkout.completed` in `eventCallback` gives `data.transaction_id`: the page fires browser `Purchase` with
   event_id `purchase_<transaction_id>` and goes to the thank-you step with `?paid=<transaction_id>`.
4. **Webhook** `/webhooks/paddle` is the source of truth. Verify `Paddle-Signature` (`ts=…;h1=…`):
   HMAC-SHA256 of `"<ts>:<raw body>"` with `PADDLE_WEBHOOK_SECRET`, constant-time compare, reject if `ts` is older
   than 5 minutes. Then:
   - `transaction.completed` with `origin` `web` (first purchase) → CAPI `Purchase`, event_id
     `purchase_<transaction id>`, value `details.totals.total / 100`, `currency_code`; push to app webhook.
   - `subscription.created|updated|canceled|past_due|paused|resumed` → push to app webhook.
   Answer 200 quickly; Paddle retries failed deliveries.

`custom_data` passed at checkout is copied to the transaction and the subscription, so the webhook and the
subscription API can see `source`, `funnel_session`, `uid`.

## Notification destination

`setup_paddle.mjs --webhook https://<service-url>/webhooks/paddle` creates a notification setting for the events
above and prints `endpoint_secret_key` once; store it as `PADDLE_WEBHOOK_SECRET`. Repeat for the final domain.

## Customer self-service

Paddle returns `management_urls.cancel` and `management_urls.update_payment_method` on each subscription; the
subscription API passes them to the app, and `/manage/<access token>` redirects to the cancel URL.

## Test cards (sandbox)

`4242 4242 4242 4242` success; `4000 0038 0000 0446` 3-D Secure; `4000 0000 0000 0002` declined. Any future date,
CVC `100`.

## Write `docs/PADDLE.md`

Product, price and discount ids, intro models, custom data keys, notification destination and events, how to
find funnel subscriptions (filter by custom data in the dashboard or by customer email via the API).

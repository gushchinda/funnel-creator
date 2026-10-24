# Welcome email after purchase

Every funnel sends one email right after the first payment: the plan is active, how to open the app, what was
bought, how to cancel. It is the buyer's way back to the app if they closed the thank-you screen, and the receipt
they look for when they forget what they bought. Sent by `templates/server/lib/email.js`; templates in
`templates/server/emails/welcome.html` and `welcome.txt`.

## What the user decides (first run, Block E)

1. **Email service**: Resend (default: simplest setup, built-in idempotency), Postmark or SendGrid. If the app
   already sends mail through one of them, use that account.
2. **Sender**: `EMAIL_FROM`, for example `WallFlow <hello@wallflow.app>`. The domain must be verified in the
   email service (SPF + DKIM DNS records); until then use the service's test sender and say so.
3. **Reply-to / support address**: `product.legal.support_email` in `funnel.config.json` (shown in the email),
   optional `EMAIL_REPLY_TO`.
4. **Subject**, if not the default `Welcome to {{app}}: your plan is active` (`EMAIL_SUBJECT`).

The API key goes into `EMAIL_API_KEY` (env / Secret Manager, never chat or git). Guide the user through creating
it with `references/setup-guide.md` section 4a.

## What the email contains

- "Open <app>" button → `<BASE_URL>/open/<access token>`. That page tries the deep link
  (`product.after_purchase.deep_link?token=…`) and shows the store links. Mail apps drop custom-scheme links,
  so the button never points at the deep link directly. Without a deep link the button goes to the App Store link.
- Store links, the plan label and terms (`payments.plans[].label` / `terms`), the email to sign in with.
- "Manage subscription" → `<BASE_URL>/manage/<access token>` (Stripe Billing Portal / Paddle).
- Support address and subscription terms link.

`BASE_URL` must be set on the deploy (test URL first, domain later): without it the email has no Open and
Manage links. Write the template in the funnel's language and restyle it with the funnel's brand colour and
logo; keep inline styles and the table layout (mail clients ignore `<style>` and flexbox).

## When it is sent, and only once

Both payment confirmations call `purchased()` in `server.js`: the on-site completion (`/api/stripe/complete`,
`/api/paddle/complete`) and the webhook (`invoice.paid` with `billing_reason = subscription_create`,
`transaction.completed`). Repeats are stopped by the order id in memory, by `metadata.onboarded = "1"` on the
Stripe subscription after sending, and by Resend's `Idempotency-Key` (24 h). With Postmark or SendGrid two Cloud
Run instances racing on the same purchase can, rarely, send twice; acceptable, and noted in the report.

Failures never block the purchase: they log `{"kind":"email_error"}` and the buyer still lands on the
thank-you step. Success logs `{"kind":"email_sent"}`.

## Verify (phase 8)

1. Deploy with `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `BASE_URL`.
2. Make a test purchase with an inbox you can read (the user's own address, with their permission).
3. Check the log line `email_sent`, the email in the inbox (not spam), and both buttons: Open (on a phone) and
   Manage (opens the Billing Portal).
4. Put a screenshot of the email in the report.

Turning it off: leave `EMAIL_PROVIDER` empty.

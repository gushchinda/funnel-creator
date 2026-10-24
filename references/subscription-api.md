# Phase 7: subscription status API for the app

The app must know whether a person who paid in the web funnel has access. The funnel server answers that from
the payment provider directly: no database, no sync job. The public contract is `templates/developer-spec.md`;
this file is how it is implemented and what to decide per funnel.

## Endpoints (implemented in `templates/server/lib/subscriptions.js`)

| Endpoint | Auth | For |
|---|---|---|
| `GET /v1/subscription?email=…` | `Authorization: Bearer <FUNNEL_API_KEY>` | the app's **backend** (server to server) |
| `GET /v1/me` | `Authorization: Bearer <access token>` | the **app itself**, when it has no backend |
| `GET /manage/<access token>` | token in path | "Manage subscription" button: Stripe Billing Portal or Paddle cancel page |
| push to `APP_WEBHOOK_URL` | `X-Funnel-Signature` HMAC | the app's backend, optional |

`FUNNEL_API_KEY` must never ship inside a mobile app: anyone can extract it. Apps without a backend use the
per-user access token.

## Access token

A signed, stateless token: `base64url({p: provider, c: customer id, e: email, u: app user id, t: issued at}) +
"." + HMAC-SHA256(ACCESS_TOKEN_SECRET)`. It is issued after payment and delivered to the app:
- the thank-you step shows "Open the app" linking to `<deep_link>?token=<access token>` (and the store links if
  the app is not installed; the app can also read the token from the clipboard or a deferred deep link provider
  if the user's app already uses one);
- the welcome email, if the funnel sends one, carries the same link.
Rotating `ACCESS_TOKEN_SECRET` revokes all tokens. The token only reads status and opens the manage page.

## Lookup

- Stripe: `customers.list({ email })`, keep customers whose `metadata.source` is this funnel's slug (or any of the
  user's funnel slugs, listed in `SOURCES`), then `subscriptions.list({ customer, status: 'all' })`.
- Paddle: `GET /customers?email=<email>`, then `GET /subscriptions?customer_id=<id>`, keep those whose
  `custom_data.source` matches.
- Pick the subscription that gives access, else the most recent one. Return all of them in `subscriptions`.
- Cache answers for 60 s per email; webhooks for that customer clear the cache entry.

## Access rule

`has_access = status in (active, trialing)`, or `past_due` within `GRACE_DAYS` (default 3) after
`current_period_end`. A subscription set to cancel at period end keeps access until then. `access_until` is the
date access ends if nothing else happens (period end or trial end). Put the rule in the spec so the app does not
re-implement it differently: the app should trust `has_access`.

## Status mapping

| Normalised | Stripe | Paddle |
|---|---|---|
| `active` | `active` | `active` |
| `trialing` | `trialing` | `trialing` |
| `past_due` | `past_due`, `unpaid` | `past_due` |
| `paused` | `paused` | `paused` |
| `canceled` | `canceled`, `incomplete_expired` | `canceled` |
| `incomplete` | `incomplete` | (no equivalent) |

`cancel_at_period_end`: Stripe `cancel_at_period_end`; Paddle `scheduled_change.action === 'cancel'`.

## Push webhook (optional)

When `APP_WEBHOOK_URL` is set, every provider webhook that changes a subscription posts
`{type: "subscription.updated", occurred_at, data: <same object as GET /v1/subscription>}` to it, signed with
`X-Funnel-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>" with APP_WEBHOOK_SECRET>`. Fire and forget with
two retries; the app backend must also be able to fall back to `GET /v1/subscription`.

## Linking to app accounts

Decide with the user at first run (`app.identity`):
- **email**: the app asks for the email used in the funnel and its backend calls `GET /v1/subscription?email=`.
  The app should verify the email (one-time code) before granting access, otherwise anyone can type a buyer's
  email. Say this in the spec.
- **app user id**: the app opens the funnel with `?uid=<id>`; `uid` is stored in provider metadata, sent back in
  every response and push, and included in the access token.
- **deep link token**: the app receives the access token after purchase and calls `GET /v1/me`.

## Deliverable

`<funnel>/docs/developer-spec.md` from the template, with the real base URL (test URL first, domain later),
provider, plan ids and their meaning, identity mode, and curl examples that work against the test deploy
(with a test purchase's email). Send it to the user to forward; never include keys in it, only their names and
"we will send the key separately".

# Phase 6: Meta Pixel + Conversions API

Every funnel sends these events from the browser (Pixel) **and** the server (Conversions API) with the same
`event_name` and `event_id`, so Meta keeps one and uses the server copy to fill what ad blockers and iOS drop.

| Moment | Event | event_id | Sent by |
|---|---|---|---|
| Any page load | `PageView` | (none) | browser only |
| Email submitted | `CompleteRegistration` | `reg_<session id>` | bridge → pixel + `POST /api/registration` → CAPI |
| Paywall CTA pressed | `InitiateCheckout` | `ic_<session id>_<plan>` | bridge → pixel; server → CAPI in `/api/checkout` |
| First payment confirmed | `Purchase` | Stripe: `purchase_<subscription id>`; Paddle: `purchase_<transaction id>` | pay page → pixel; webhook → CAPI |

Rules:
- `CompleteRegistration` and `Purchase` fire once per session / per subscription. The bridge keeps a flag in
  `sessionStorage`; the server keeps a short-lived set of sent ids, and Meta deduplicates the rest.
- `Purchase` from the server only after the provider confirms payment (webhook). `value` is the amount actually
  charged today, `currency` ISO upper-case, `content_ids: [plan]`, `order_id` = subscription or transaction id.
- `custom_data.funnel` = variant slug on every event, so variants can be compared in Ads Manager breakdowns.
- Optional extra events when the reference funnel or the user's ad setup needs them: `Lead` on the first answer,
  `ViewContent` on the paywall. Do not add events the ad account is not going to optimise on.

## Server event shape

```json
{
  "event_name": "Purchase",
  "event_time": 1767225600,
  "event_id": "purchase_sub_123",
  "action_source": "website",
  "event_source_url": "https://quiz.example.com/pay/…",
  "user_data": {
    "em": ["<sha256 of trimmed lower-case email>"],
    "external_id": ["<sha256 of session id or app user id>"],
    "fbp": "fb.1.…", "fbc": "fb.1.…",
    "client_ip_address": "<first x-forwarded-for>",
    "client_user_agent": "<user agent>"
  },
  "custom_data": { "currency": "USD", "value": 9.99, "content_ids": ["month"], "order_id": "sub_123", "funnel": "acme-sleep-men" }
}
```

POST to `https://graph.facebook.com/v21.0/<META_PIXEL_ID>/events?access_token=<META_CAPI_TOKEN>` with
`{"data": [event], "test_event_code": "<META_TEST_EVENT_CODE>"}` (test code only when the env var is set).
Use the newest Graph API version available when you build; v21.0 is the minimum.

The webhook has no browser request, so the checkout token stores `fbp`, `fbc`, IP, user agent and page URL at
`/api/checkout`, and the server puts them into provider metadata (`fbp`, `fbc`, `ip`, `ua`) so the webhook can
rebuild `user_data`. Keep metadata values under the provider's length limits (Stripe: 500 chars).

## Browser

- Pixel base code in `<head>` of every HTML page, including `pay.html`.
- `fbq('track', name, data, { eventID })` with the same id as the server.
- If `fbq` is blocked, still call the server endpoints; CAPI alone is better than nothing.

## Verify before hand-off (test deploy)

1. Set `META_TEST_EVENT_CODE`, walk the funnel on a phone-sized browser, pay with a test card.
2. Events Manager → Test events: `PageView`, `CompleteRegistration`, `InitiateCheckout`, `Purchase` each appear
   from **Browser** and **Server**, marked deduplicated, `Purchase` with value and currency.
3. Event match quality for server events shows email, external id, IP, user agent, fbp.
4. Screenshot the Test events list into `report/` (crop out any email addresses).
5. Remove `META_TEST_EVENT_CODE` from the live deploy.

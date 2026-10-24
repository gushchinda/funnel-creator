# {{APP_NAME}}: web funnel subscriptions, integration spec for the app

Version {{DATE}} · funnel `{{SLUG}}` · payments: {{PROVIDER}}

People buy a subscription to {{APP_NAME}} in a web funnel at `{{BASE_URL}}`, before they install the app. This
document explains how the app finds out that a person has paid and how long their access lasts. Payments are
handled by {{PROVIDER}}; the funnel server reads subscription state from {{PROVIDER}} in real time.

## 1. What you need to do

1. When a user signs in, ask the funnel API whether they have access (section 3 or 4), and unlock premium if
   `has_access` is `true`.
2. Re-check on every app launch, and at least once a day while the app is open. Cache the last answer and keep
   access offline until `access_until`.
3. Add a "Manage subscription" button that opens `subscription.manage_url` in the browser.
4. Do not sell the same subscription again in the app to someone who has web access (hide the in-app paywall
   while `has_access` is `true`).

## 2. How the app learns who paid

{{IDENTITY_SECTION}}

<!-- Pick one block when filling the template, delete the others. -->
<!-- email:
The person enters the same email in the app that they used in the funnel. Verify that they own it (send a
one-time code) before granting access: the API answers for any email, so an unverified email field would let
anyone unlock premium with a buyer's address. Then your backend calls `GET /v1/subscription?email=…`.
-->
<!-- uid:
The app opens the funnel with its own user id: `{{BASE_URL}}/?uid=<app user id>`. The id is stored with the
subscription and returned as `app_user_id` in every response and webhook, so your backend can match the
purchase to the account without asking for an email.
-->
<!-- token:
After payment the funnel's thank-you screen opens `{{DEEP_LINK}}?token=<access token>`. Store the token in
secure storage (Keychain / EncryptedSharedPreferences) and call `GET /v1/me` with it. The token does not expire;
it only gives read access to this person's subscription and the manage page.
If the app is not installed yet, the button opens the store; the same link is in the welcome email, so the
person can open it after installing.
-->

## 3. Server to server: `GET /v1/subscription`

For your backend only. The key gives access to every customer's status, so it must never be put in the app.

```
GET {{BASE_URL}}/v1/subscription?email=jane%40example.com
Authorization: Bearer <FUNNEL_API_KEY>
```

The key is sent to you separately. Rate limit: 10 requests per second per key.

## 4. From the app: `GET /v1/me`

```
GET {{BASE_URL}}/v1/me
Authorization: Bearer <access token>
```

## 5. Response (both endpoints)

```json
{
  "email": "jane@example.com",
  "app_user_id": "u_123",
  "has_access": true,
  "access_until": "2026-12-01T10:00:00Z",
  "subscription": {
    "id": "sub_1Q…",
    "provider": "{{PROVIDER_ID}}",
    "status": "active",
    "plan": "month",
    "price": { "amount": 4400, "currency": "usd", "interval": "week", "interval_count": 4 },
    "started_at": "2026-10-23T10:00:00Z",
    "current_period_end": "2026-12-01T10:00:00Z",
    "trial_end": null,
    "cancel_at_period_end": false,
    "canceled_at": null,
    "funnel": "{{SLUG}}",
    "manage_url": "{{BASE_URL}}/manage/eyJ…"
  },
  "subscriptions": [ { "...": "every subscription this person has from the funnel, newest first" } ]
}
```

No purchase found: `200` with `"has_access": false, "subscription": null, "subscriptions": []`.

| Field | Meaning |
|---|---|
| `has_access` | **Use this.** `true` while the person should have premium. Already includes trials, cancel-at-period-end and a {{GRACE_DAYS}}-day grace period for failed renewals. |
| `access_until` | When access ends unless the subscription renews. Use it for offline caching. |
| `subscription.status` | `active`, `trialing`, `past_due` (renewal failed, retrying), `paused`, `canceled`, `incomplete` (first payment not finished). For display only. |
| `subscription.plan` | Funnel plan id: {{PLAN_LIST}} |
| `price.amount` | Renewal price in minor units (cents). |
| `cancel_at_period_end` | `true` if the person cancelled; access continues until `current_period_end`. |
| `manage_url` | Opens the payment provider's page to cancel or change the card. |

Errors: `401` missing or wrong key/token, `400` missing `email`, `429` rate limit, `502` payment provider
unavailable (keep the cached answer and retry later).

## 6. Webhooks to your backend (optional)

If you give us a URL, the funnel posts every subscription change to it:

```
POST <your url>
Content-Type: application/json
X-Funnel-Signature: t=1767225600,v1=5f2b…

{ "type": "subscription.updated", "occurred_at": "2026-10-23T10:00:05Z", "data": { …same object as section 5… } }
```

Verify: compute HMAC-SHA256 of `"<t>.<raw body>"` with the webhook secret we send you, hex-encode, compare with
`v1` in constant time, and reject if `t` is more than 5 minutes old. Answer `2xx` within 5 seconds. Deliveries
are retried twice; treat the webhook as a hint and the `GET` endpoint as the source of truth.

## 7. Examples

```bash
curl -s "{{BASE_URL}}/v1/subscription?email=jane%40example.com" -H "Authorization: Bearer $FUNNEL_API_KEY"
curl -s "{{BASE_URL}}/v1/me" -H "Authorization: Bearer $ACCESS_TOKEN"
```

```swift
var req = URLRequest(url: URL(string: "{{BASE_URL}}/v1/me")!)
req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
let (data, _) = try await URLSession.shared.data(for: req)
let status = try JSONDecoder().decode(FunnelStatus.self, from: data)   // unlock if status.has_access
```

```kotlin
val req = Request.Builder().url("{{BASE_URL}}/v1/me").header("Authorization", "Bearer $token").build()
client.newCall(req).execute().use { r -> val hasAccess = JSONObject(r.body!!.string()).getBoolean("has_access") }
```

## 8. Testing

Test environment: `{{TEST_BASE_URL}}` ({{PROVIDER}} test mode). Buy any plan with card `4242 4242 4242 4242`,
any future expiry date, CVC `100`, then call the endpoints with the email you used. Test and live are separate:
a test purchase never appears in live.

## 9. Contacts

Questions about this API: {{CONTACT}}.

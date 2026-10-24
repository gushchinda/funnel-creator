# Funnel analytics

Every funnel ships with step-by-step analytics and a password-protected dashboard at `/analytics`. There is no
database: events are structured log lines, a Cloud Logging sink copies them into BigQuery, and the dashboard
queries BigQuery.

```
browser (FunnelBridge.track) ─┐
server (lead/checkout/purchase)┴─> stdout {"kind":"funnel_event",…} ─> Cloud Logging ─sink─> BigQuery
                                                                                              │
                                                  /analytics (Basic auth) <── /api/analytics ─┘
```

## Events

| Event | Sent by | When |
|---|---|---|
| `step_view` | browser, `FunnelBridge.track('step_view', { step, index })` | every step render, including info screens and the paywall |
| `lead` | server, `/api/registration` | email submitted |
| `checkout` | server, `/api/checkout` | paywall CTA pressed (pay token issued) |
| `purchase` | server, Stripe `/api/stripe/complete` + webhook, Paddle webhook | first payment confirmed |
| `server_start` | server | once per cold start; creates every column before real events need it |

All events carry `session` (the bridge's session id), so the dashboard counts **sessions**, not page loads, and
deduplicates a purchase reported twice (complete + webhook). The first `utm_source` a session saw is its source.
Sessions opened through `?step=` deep links with demo answers set `state.demo` and are not tracked, so QA and
screenshot runs stay out of the numbers.

## Setup (once per Google Cloud project)

```bash
scripts/setup_analytics.sh <funnel-dir>
```

It enables BigQuery, creates the dataset `funnel_analytics` (override: `analytics.dataset` in
`funnel.config.json`), a project sink `funnel-events` with filter
`resource.type="cloud_run_revision" AND jsonPayload.kind="funnel_event"`, gives the sink's writer identity
BigQuery Data Editor, and gives the Cloud Run runtime account (default compute account, or `RUNTIME_SA`) BigQuery
Data Viewer and Job User. One setup serves every funnel in the project; each service's dashboard filters by its
own funnel name. Safe to re-run.

Then per funnel:
1. Generate a dashboard password and keep it in Secret Manager, never in git or chat:
   `openssl rand -base64 18 | gcloud secrets create <slug>-analytics-password --data-file=-`, grant the runtime
   account `roles/secretmanager.secretAccessor` on it, and map it in `funnel.config.json → gcp.secrets`
   (`"ANALYTICS_PASSWORD": "<slug>-analytics-password"`).
2. Deploy. Without `ANALYTICS_PASSWORD` the dashboard answers 404 and events are still logged.
3. Tell the user where the password is (the Secret Manager page link), not the password itself.

## Front end

In the renderer, after each step is drawn:

```js
FunnelBridge.track('step_view', { step: step.id, index: STEPS.indexOf(step) });
```

and set `FunnelBridge.save({ demo: true })` wherever `?step=` fills demo answers. `index` orders the steps in the
dashboard; keep it the position in `steps.json`.

## Dashboard

`<service url>/analytics`, any user name, the password above. Shows for a period (24 h, 7, 30, 90 days) and a
traffic source:
- visitors, emails, checkouts, purchases, visitor → purchase conversion, revenue (first payments);
- every step with sessions, share of the first step and loss from the previous step;
- plans: checkouts, purchases, rate, revenue; traffic sources; by day.

## Checking it works

Walk a few steps on the deployed funnel with `?utm_source=qa_check`, then open `/analytics?days=1&source=qa_check`.
Rows usually arrive in BigQuery within a minute. If the dashboard says "No events yet" for longer:
- `gcloud logging read 'jsonPayload.kind="funnel_event"' --freshness 10m` shows the log lines? If not, the
  front end is not calling `track`, or `/api/events` answers 400.
- `gcloud logging sinks describe funnel-events` exists and its writer identity has BigQuery Data Editor?
- the very first events after the sink is created can be lost while BigQuery creates the table; the
  `server_start` line usually creates it first.

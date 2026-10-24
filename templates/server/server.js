// Funnel server: serves web/, starts checkouts (Stripe or Paddle), sends Meta CAPI events,
// and answers the app's subscription status API. Configure with env vars (see .env.example) and plans.js.
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { PLANS, CURRENCY, CONFIG } from "./plans.js";
import { capi as makeCapi } from "./lib/capi.js";
import { tokens } from "./lib/tokens.js";
import { stripeProvider } from "./lib/stripe.js";
import { paddleProvider } from "./lib/paddle.js";
import { subscriptionApi } from "./lib/subscriptions.js";
import { analytics } from "./lib/analytics.js";
import { mailer } from "./lib/email.js";
import { appService } from "./lib/app-service.js";

const env = process.env;
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const SOURCE = env.FUNNEL_SOURCE || CONFIG.source || CONFIG.slug; // tag on every provider object, e.g. "acme-funnels"
const FUNNEL = env.FUNNEL_NAME || CONFIG.slug;                      // this variant, e.g. "acme-sleep-men"
const SOURCES = (env.FUNNEL_SOURCES || SOURCE || "").split(",").map((s) => s.trim()).filter(Boolean);
const THANK_YOU = env.THANK_YOU_PATH || "/?step=thank-you";

const PAY_TTL = 48 * 3600e3;
const payTokens = tokens(env.TOKEN_SECRET);
const payToken = { make: (p) => payTokens.make(p), read: (t) => payTokens.read(t, PAY_TTL) };
const access = tokens(env.ACCESS_TOKEN_SECRET);
const mail = mailer({ env, config: CONFIG });
const service = appService({ env });
const capi = makeCapi({ pixelId: env.META_PIXEL_ID, token: env.META_CAPI_TOKEN, testCode: env.META_TEST_EVENT_CODE, funnel: FUNNEL });

const clientIp = (req) => (req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Metadata / custom data on every provider object: how webhooks rebuild CAPI user_data and how the API finds buyers.
const meta = (tok) => Object.fromEntries(Object.entries({
  source: SOURCE, funnel: FUNNEL, funnel_session: tok.session, plan: tok.plan, uid: tok.uid,
  fbp: tok.fbp, fbc: tok.fbc, ip: tok.ip, ua: str(tok.ua, 400), page: str(tok.page, 400),
  utm_source: tok.utm?.source, utm_campaign: tok.utm?.campaign, utm_content: tok.utm?.content,
  ...service.meta(tok),
}).filter(([, v]) => v));

let subs; // created after the provider; providers call notify() lazily
let stats; // funnel analytics, created with the app; providers call track() lazily
const success = ({ id, plan, value, currency, customerId, email, uid }) => {
  const u = new URL(THANK_YOU, "http://x");
  u.searchParams.set("paid", id);
  u.searchParams.set("plan", plan);
  u.searchParams.set("value", String(value));
  u.searchParams.set("currency", String(currency).toUpperCase());
  u.searchParams.set("access", subs.accessToken({ id: customerId, email }, uid));
  return u.pathname + u.search;
};

// First payment confirmed (on-site completion or webhook, whichever comes first): welcome email and hand-off to the
// app's subscription service. Both paths call it; the order id keeps it to once per instance.
const onboarded = new Set();
async function purchased({ provider: p, order, subscriptionId, customerId, email, uid, plan }) {
  if (onboarded.has(order)) return;
  onboarded.add(order);
  try {
    await Promise.all([
      mail.welcome({ order, email, plan: PLANS[plan], accessToken: subs.accessToken({ id: customerId, email }, uid), baseUrl: env.BASE_URL }),
      service.purchased({ provider: p, subscriptionId, uid, email }),
    ]);
  } catch (e) {
    console.error(JSON.stringify({ kind: "onboard_error", order, error: e.message }));
  }
}

const ctx = {
  env, plans: PLANS, currency: CURRENCY, source: SOURCE, sources: SOURCES, funnel: FUNNEL,
  capi, pay: payToken, meta, success, notify: (...a) => subs.notify(...a), track: (...a) => stats.log(...a), purchased,
};
const provider = env.PAYMENT_PROVIDER === "paddle" ? paddleProvider(ctx) : stripeProvider(ctx);

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
// Webhooks need the raw body for signature checks, so JSON parsing skips them.
app.use((req, res, next) => (req.path.startsWith("/webhooks/") ? next() : express.json({ limit: "64kb" })(req, res, next)));

// run.app reserves /healthz at its front end, so /health is the one to probe on Cloud Run.
stats = analytics({ app, env, funnel: FUNNEL });

app.get(["/healthz", "/health"], (_req, res) => res.send("ok"));

// Plans for the paywall, so prices live only in funnel.config.json.
app.get("/api/plans", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300").json({
    currency: CURRENCY.toUpperCase(),
    plans: Object.values(PLANS).map(({ id, label, terms, today, renew, period, intro }) => ({ id, label, terms, today, renew, period, intro })),
  });
});

// Email submitted: CompleteRegistration, deduplicated with the browser pixel by event_id.
app.post("/api/registration", (req, res) => {
  const b = req.body || {};
  const email = str(b.email).trim();
  if (!email.includes("@") || !/^reg_[\w-]{4,80}$/.test(b.event_id || "")) return res.status(400).json({ error: "bad_request" });
  console.log(JSON.stringify({ kind: "lead", funnel: FUNNEL, session: b.session_id, answers: b.answers, utm: b.utm }));
  stats.log("lead", { session: str(b.session_id, 80), utm: b.utm });
  capi.send({
    event_name: "CompleteRegistration", event_id: b.event_id, event_source_url: str(b.page_url, 400),
    user_data: capi.user({ email, externalId: str(b.uid) || str(b.session_id), fbp: str(b.fbp), fbc: str(b.fbc), ip: clientIp(req), ua: req.get("user-agent") }),
  });
  res.json({ ok: true });
});

// Paywall CTA: signed pay token + InitiateCheckout.
app.post("/api/checkout", (req, res) => {
  const b = req.body || {};
  const plan = PLANS[b.plan] ? b.plan : null;
  const email = str(b.email).trim();
  if (!plan || !email.includes("@") || !str(b.session_id)) return res.status(400).json({ error: "bad_request" });
  const tok = {
    plan, email, session: str(b.session_id, 80), uid: str(b.uid, 120) || undefined, locale: str(b.locale, 5) || "en",
    fbp: str(b.fbp), fbc: str(b.fbc), ip: clientIp(req), ua: req.get("user-agent") || "", page: str(b.page_url, 400),
    utm: b.utm && typeof b.utm === "object" ? { source: str(b.utm.source, 100), campaign: str(b.utm.campaign, 100), content: str(b.utm.content, 100) } : undefined,
  };
  const value = PLANS[plan].today / 100;
  stats.log("checkout", { session: tok.session, plan, amount: PLANS[plan].today, currency: CURRENCY, utm: tok.utm });
  capi.send({
    event_name: "InitiateCheckout", event_id: `ic_${tok.session}_${plan}`, event_source_url: tok.page,
    user_data: capi.user({ email, externalId: tok.uid || tok.session, fbp: tok.fbp, fbc: tok.fbc, ip: tok.ip, ua: tok.ua }),
    custom_data: { currency: CURRENCY.toUpperCase(), value, content_ids: [plan] },
  });
  res.json({ url: `/pay/${payToken.make(tok)}`, value, currency: CURRENCY.toUpperCase() });
});

app.get("/pay/:token", (req, res) => {
  if (!payToken.read(req.params.token)) return res.redirect(302, "/");
  // The token is signed, not encrypted: keep it out of Referer headers sent to third parties.
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "same-origin" }).sendFile(path.join(WEB, "pay.html"));
});

// "Open the app" from the welcome email: tries the deep link with the access token, then offers the stores.
app.get("/open/:token", (req, res) => {
  const links = CONFIG.product?.after_purchase || {};
  if (!access.read(req.params.token) || !links.deep_link) return res.redirect(302, links.ios || links.android || "/");
  const deep = `${links.deep_link}${links.deep_link.includes("?") ? "&" : "?"}token=${encodeURIComponent(req.params.token)}`;
  const name = esc(CONFIG.product?.name || "the app");
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).send(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Open ${name}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;text-align:center">
<h1 style="font-size:22px">Opening ${name}…</h1><p><a href="${esc(deep)}">Open ${name}</a></p>
${links.ios ? `<p><a href="${esc(links.ios)}">Get it on the App Store</a></p>` : ""}
${links.android ? `<p><a href="${esc(links.android)}">Get it on Google Play</a></p>` : ""}
<script>location.href=${JSON.stringify(deep).replace(/</g, "\\u003c")}</script></body>`);
});

provider.register(app);
subs = subscriptionApi({
  app, provider, access, apiKey: env.FUNNEL_API_KEY, graceDays: Number(env.GRACE_DAYS || 3),
  baseUrl: env.BASE_URL, appWebhookUrl: env.APP_WEBHOOK_URL, appWebhookSecret: env.APP_WEBHOOK_SECRET,
});

app.use(express.static(WEB, {
  index: "index.html",
  setHeaders: (res, file) => res.set("Cache-Control", /\.(html)$/.test(file) ? "no-cache" : "public, max-age=86400"),
}));
app.use((_req, res) => res.status(404).send("Not found"));

app.listen(Number(env.PORT || 8080), () => console.log(`${FUNNEL} (${provider.name}) on :${env.PORT || 8080}`));

// Subscription status API for the mobile app. Contract: templates/developer-spec.md.
// Reads live state from the payment provider; no database. See references/subscription-api.md.
import crypto from "node:crypto";
import { safeEqual } from "./tokens.js";

const CACHE_MS = 60e3;

export function subscriptionApi({ app, provider, access, apiKey, graceDays = 3, baseUrl, appWebhookUrl, appWebhookSecret }) {
  const cache = new Map(); // email -> { at, body }
  const hits = new Map();  // per-second request counter for the server key

  const hasAccess = (s, now = Date.now()) => {
    if (["active", "trialing"].includes(s.status)) return true;
    if (s.status === "past_due" && s.current_period_end) return now < Date.parse(s.current_period_end) + graceDays * 864e5;
    return false;
  };

  const accessUntil = (s) => {
    if (s.status === "trialing" && s.trial_end) return s.trial_end;
    if (s.status === "past_due" && s.current_period_end) return new Date(Date.parse(s.current_period_end) + graceDays * 864e5).toISOString();
    return s.current_period_end;
  };

  const accessToken = (c, uid) => access.make({ p: provider.name, c: c.id, e: c.email, u: uid || null });

  async function statusFor(customers, req) {
    const all = [];
    for (const c of customers) for (const s of await provider.subscriptionsFor(c.id)) all.push({ ...s, _c: c });
    all.sort((a, b) => Number(hasAccess(b)) - Number(hasAccess(a)) || b.created - a.created);
    const base = baseUrl || (req ? `https://${req.get("host")}` : null);
    const out = all.map(({ _c, created, ...s }) => ({
      ...s, manage_url: base ? `${base}/manage/${accessToken(_c, s.app_user_id)}` : null,
    }));
    const main = out[0] || null;
    return {
      email: customers[0]?.email || null,
      app_user_id: main?.app_user_id || null,
      has_access: main ? hasAccess(main) : false,
      access_until: main && hasAccess(main) ? accessUntil(main) : null,
      subscription: main,
      subscriptions: out,
    };
  }

  async function byEmail(email, req) {
    const key = email.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
    const body = await statusFor(await provider.customersByEmail(key), req);
    if (!body.email) body.email = key;
    cache.set(key, { at: Date.now(), body });
    return body;
  }

  const limited = () => {
    const sec = Math.floor(Date.now() / 1000);
    const n = (hits.get(sec) || 0) + 1;
    hits.clear();
    hits.set(sec, n);
    return n > 10;
  };

  app.get("/v1/subscription", async (req, res) => {
    const auth = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!apiKey || !safeEqual(auth, apiKey)) return res.status(401).json({ error: "unauthorized" });
    if (limited()) return res.status(429).json({ error: "rate_limited" });
    const email = String(req.query.email || "");
    if (!email.includes("@")) return res.status(400).json({ error: "email_required" });
    try {
      res.json(await byEmail(email, req));
    } catch (e) {
      console.error(JSON.stringify({ kind: "status_error", error: e.message }));
      res.status(502).json({ error: "provider_unavailable" });
    }
  });

  app.get("/v1/me", async (req, res) => {
    const tok = access.read((req.get("authorization") || "").replace(/^Bearer\s+/i, ""));
    if (!tok || tok.p !== provider.name) return res.status(401).json({ error: "unauthorized" });
    try {
      res.json(await statusFor([{ id: tok.c, email: tok.e }], req));
    } catch (e) {
      console.error(JSON.stringify({ kind: "status_error", error: e.message }));
      res.status(502).json({ error: "provider_unavailable" });
    }
  });

  app.get("/manage/:token", async (req, res) => {
    const tok = access.read(req.params.token);
    if (!tok || tok.p !== provider.name) return res.status(404).send("Link expired");
    try {
      const url = await provider.manageUrl(tok.c, baseUrl || `https://${req.get("host")}`);
      url ? res.redirect(302, url) : res.status(404).send("No subscription found");
    } catch (e) {
      console.error(JSON.stringify({ kind: "manage_error", error: e.message }));
      res.status(502).send("Please try again in a minute");
    }
  });

  // Called by provider webhooks whenever a funnel customer's subscription may have changed.
  async function notify(customerId, email) {
    try {
      const c = email ? { id: customerId, email } : await provider.customer(customerId);
      if (!c) return;
      if (c.email) cache.delete(c.email.trim().toLowerCase());
      if (!appWebhookUrl) return;
      const data = await statusFor([c]);
      const body = JSON.stringify({ type: "subscription.updated", occurred_at: new Date().toISOString(), data });
      for (let attempt = 0; attempt < 3; attempt++) {
        const t = Math.floor(Date.now() / 1000);
        const v1 = crypto.createHmac("sha256", appWebhookSecret || "").update(`${t}.${body}`).digest("hex");
        try {
          const r = await fetch(appWebhookUrl, {
            method: "POST", body, signal: AbortSignal.timeout(5000),
            headers: { "Content-Type": "application/json", "X-Funnel-Signature": `t=${t},v1=${v1}` },
          });
          if (r.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
      console.error(JSON.stringify({ kind: "app_webhook_failed", customer: customerId }));
    } catch (e) {
      console.error(JSON.stringify({ kind: "notify_error", error: e.message }));
    }
  }

  return { notify, accessToken };
}

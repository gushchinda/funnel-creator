// Paddle Billing: Paddle.js inline checkout on /pay/<token>, webhook as the source of truth for Purchase.
// See references/paddle.md. API docs: https://developer.paddle.com/api-reference/overview
import crypto from "node:crypto";
import express from "express";

const STATUS = { active: "active", trialing: "trialing", past_due: "past_due", paused: "paused", canceled: "canceled" };

export function paddleProvider(ctx) {
  const { env, plans, source, funnel, capi, pay, success, meta, notify, track } = ctx;
  if (!env.PADDLE_API_KEY || !env.PADDLE_CLIENT_TOKEN) throw new Error("PADDLE_API_KEY and PADDLE_CLIENT_TOKEN are required");
  const sandbox = env.PADDLE_ENV !== "production";
  const BASE = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

  async function api(path, { method = "GET", body } = {}) {
    const r = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}`, "Content-Type": "application/json", "Paddle-Version": "1" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`paddle ${method} ${path.split("?")[0]} ${r.status} ${j.error?.code || ""}`);
    return j.data;
  }

  function normalize(s) {
    const item = s.items?.find((i) => i.price?.billing_cycle) || s.items?.[0];
    return {
      id: s.id, provider: "paddle", customer_id: s.customer_id,
      status: STATUS[s.status] || s.status, plan: s.custom_data?.plan || null, app_user_id: s.custom_data?.uid || null,
      price: item ? {
        amount: Number(item.price.unit_price.amount), currency: item.price.unit_price.currency_code.toLowerCase(),
        interval: s.billing_cycle?.interval || null, interval_count: s.billing_cycle?.frequency || null,
      } : null,
      started_at: s.started_at || null,
      current_period_end: s.current_billing_period?.ends_at || null,
      trial_end: s.status === "trialing" ? s.current_billing_period?.ends_at || null : null,
      cancel_at_period_end: s.scheduled_change?.action === "cancel",
      canceled_at: s.canceled_at || null,
      funnel: s.custom_data?.funnel || null,
      created: Math.floor(Date.parse(s.created_at) / 1000),
    };
  }

  // Paddle-Signature: ts=<unix>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>">
  function verify(raw, header) {
    const parts = Object.fromEntries(String(header || "").split(";").map((p) => p.split("=")));
    if (!parts.ts || !parts.h1 || Math.abs(Date.now() / 1000 - Number(parts.ts)) > 300) return false;
    const want = crypto.createHmac("sha256", env.PADDLE_WEBHOOK_SECRET || "").update(`${parts.ts}:${raw}`).digest("hex");
    return want.length === parts.h1.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(parts.h1));
  }

  function register(app) {
    app.get("/api/paddle/config/:token", (req, res) => {
      const tok = pay.read(req.params.token);
      if (!tok) return res.status(404).json({ error: "expired" });
      const p = plans[tok.plan];
      res.json({
        provider: "paddle", env: sandbox ? "sandbox" : "production", clientToken: env.PADDLE_CLIENT_TOKEN,
        email: tok.email, locale: tok.locale, plan: tok.plan, label: p.label, terms: p.terms,
        items: p.paddle.items.map((i) => ({ priceId: i.priceId, quantity: 1 })),
        discountId: p.paddle.discountId || null,
        customData: meta(tok),
      });
    });

    app.post("/api/paddle/complete/:token", async (req, res) => {
      const tok = pay.read(req.params.token);
      if (!tok) return res.status(404).json({ error: "expired" });
      try {
        const id = String(req.body?.transactionId || "");
        let txn, paid = false;
        for (let i = 0; i < 6 && !paid; i++) {
          if (i) await new Promise((r) => setTimeout(r, 1000));
          txn = await api(`/transactions/${encodeURIComponent(id)}`);
          if (txn.custom_data?.funnel_session !== tok.session) throw new Error("transaction does not match token");
          paid = ["paid", "completed"].includes(txn.status);
        }
        if (!paid) return res.json({ paid: false });
        res.json({
          paid: true,
          redirect: success({
            id: txn.id, plan: tok.plan, value: Number(txn.details.totals.total) / 100, currency: txn.currency_code,
            customerId: txn.customer_id, email: tok.email, uid: tok.uid,
          }),
        });
      } catch (e) {
        console.error(JSON.stringify({ kind: "paddle_complete_error", error: e.message }));
        res.status(400).json({ error: "complete_failed" });
      }
    });

    app.post("/webhooks/paddle", express.raw({ type: "*/*" }), async (req, res) => {
      const raw = req.body.toString("utf8");
      if (!verify(raw, req.get("paddle-signature"))) return res.status(400).send("bad signature");
      res.json({ received: true });
      const event = JSON.parse(raw);
      try {
        await onEvent(event);
      } catch (e) {
        console.error(JSON.stringify({ kind: "paddle_webhook_error", type: event.event_type, error: e.message }));
      }
    });
  }

  async function onEvent(event) {
    const d = event.data;
    if (d.custom_data?.source !== source) return;
    if (event.event_type === "transaction.completed") {
      const customer = await api(`/customers/${d.customer_id}`);
      if (d.origin === "web" && d.subscription_id) {
        const m = d.custom_data;
        await capi.send({
          event_name: "Purchase", event_id: `purchase_${d.id}`, event_source_url: m.page || "",
          user_data: capi.user({ email: customer.email, externalId: m.uid || m.funnel_session, fbp: m.fbp, fbc: m.fbc, ip: m.ip, ua: m.ua }),
          custom_data: {
            currency: d.currency_code, value: Number(d.details.totals.total) / 100, content_ids: [m.plan],
            order_id: d.id, funnel: m.funnel || funnel,
          },
        });
        console.log(JSON.stringify({ kind: "purchase", provider: "paddle", txn: d.id, sub: d.subscription_id, plan: m.plan, funnel: m.funnel }));
        track("purchase", { session: m.funnel_session, plan: m.plan, amount: Number(d.details.totals.total), currency: d.currency_code, order: d.subscription_id });
      }
      return notify(d.customer_id, customer.email);
    }
    if (event.event_type.startsWith("subscription.")) return notify(d.customer_id);
  }

  return {
    name: "paddle",
    register,
    async customersByEmail(email) {
      const list = await api(`/customers?email=${encodeURIComponent(email)}&per_page=50`);
      return list.map((c) => ({ id: c.id, email: c.email }));
    },
    async customer(id) {
      const c = await api(`/customers/${encodeURIComponent(id)}`);
      return { id: c.id, email: c.email };
    },
    async subscriptionsFor(customerId) {
      const list = await api(`/subscriptions?customer_id=${encodeURIComponent(customerId)}&per_page=50`);
      // Paddle customers are shared by every product in the account: keep only this funnel family's subscriptions.
      return list.filter((s) => ctx.sources.includes(s.custom_data?.source)).map(normalize);
    },
    async manageUrl(customerId) {
      const subs = (await this.subscriptionsFor(customerId)).sort((a, b) => b.created - a.created);
      if (!subs.length) return null;
      const s = await api(`/subscriptions/${subs[0].id}`);
      return s.management_urls?.cancel || null;
    },
  };
}

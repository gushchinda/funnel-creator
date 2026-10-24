// Stripe: on-site Payment Element, one subscription per pay token, webhook as the source of truth for Purchase.
// See references/stripe.md for the plan models (renewal price + once coupon, or trial + one-off fee).
import express from "express";
import Stripe from "stripe";

const STATUS = {
  active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", paused: "paused",
  canceled: "canceled", incomplete_expired: "canceled", incomplete: "incomplete",
};
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);

export function stripeProvider(ctx) {
  const { env, plans, currency, source, funnel, capi, pay, success, meta, notify } = ctx;
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const subsByToken = new Map(); // retries reuse the incomplete subscription instead of stacking new ones

  function normalize(s) {
    const item = s.items?.data?.[0];
    const price = item?.price;
    return {
      id: s.id, provider: "stripe", customer_id: typeof s.customer === "string" ? s.customer : s.customer?.id,
      status: STATUS[s.status] || s.status, plan: s.metadata?.plan || null, app_user_id: s.metadata?.uid || null,
      price: price ? {
        amount: price.unit_amount, currency: price.currency,
        interval: price.recurring?.interval || null, interval_count: price.recurring?.interval_count || null,
      } : null,
      started_at: iso(s.start_date),
      current_period_end: iso(s.current_period_end ?? item?.current_period_end), // moved to items in newer API versions
      trial_end: iso(s.trial_end),
      cancel_at_period_end: Boolean(s.cancel_at_period_end || s.cancel_at),
      canceled_at: iso(s.canceled_at),
      funnel: s.metadata?.funnel || null,
      created: s.created,
    };
  }

  async function finish(tok, subId) {
    // The invoice turns paid a moment after the PaymentIntent succeeds.
    let sub, paid = false;
    for (let i = 0; i < 6 && !paid; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1000));
      sub = await stripe.subscriptions.retrieve(subId, { expand: ["latest_invoice"] });
      if (sub.metadata?.funnel_session !== tok.session) throw new Error("subscription does not match token");
      paid = sub.latest_invoice?.status === "paid" && ["active", "trialing"].includes(sub.status);
    }
    if (!paid) return { paid: false };
    const inv = sub.latest_invoice;
    // Purchase also goes out here, so funnels without a webhook endpoint still report it. The webhook sends the
    // same event_id, and Meta keeps one.
    const m = sub.metadata;
    capi.send({
      event_name: "Purchase", event_id: `purchase_${sub.id}`, event_source_url: m.page || "",
      user_data: capi.user({ email: tok.email, externalId: m.uid || m.funnel_session, fbp: m.fbp, fbc: m.fbc, ip: m.ip, ua: m.ua }),
      custom_data: { currency: inv.currency.toUpperCase(), value: inv.amount_paid / 100, content_ids: [tok.plan], order_id: sub.id, funnel: m.funnel || funnel },
    });
    console.log(JSON.stringify({ kind: "purchase", provider: "stripe", sub: sub.id, plan: tok.plan, amount: inv.amount_paid, funnel: m.funnel, via: "complete" }));
    return {
      paid: true,
      redirect: success({
        id: sub.id, plan: tok.plan, value: inv.amount_paid / 100, currency: inv.currency,
        customerId: sub.customer, email: tok.email, uid: tok.uid,
      }),
    };
  }

  function register(app) {
    app.get("/api/stripe/config/:token", (req, res) => {
      const tok = pay.read(req.params.token);
      if (!tok) return res.status(404).json({ error: "expired" });
      const p = plans[tok.plan];
      res.json({
        provider: "stripe", publishableKey: env.STRIPE_PUBLISHABLE_KEY, email: tok.email, locale: tok.locale,
        plan: tok.plan, label: p.label, terms: p.terms, amount: p.today, currency,
      });
    });

    app.post("/api/stripe/subscribe/:token", async (req, res) => {
      const tok = pay.read(req.params.token);
      if (!tok) return res.status(404).json({ error: "expired" });
      try {
        let sub = null;
        const known = subsByToken.get(req.params.token);
        if (known) {
          sub = await stripe.subscriptions.retrieve(known, { expand: ["latest_invoice.confirmation_secret"] });
          if (sub.status !== "incomplete") sub = null;
        }
        if (!sub) {
          const p = plans[tok.plan].stripe;
          const metadata = meta(tok);
          const customer = await stripe.customers.create({ email: tok.email, metadata, preferred_locales: [tok.locale] });
          sub = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: p.price }],
            ...(p.coupon ? { discounts: [{ coupon: p.coupon }] } : {}),
            ...(p.trialDays ? {
              trial_period_days: p.trialDays,
              add_invoice_items: [{ price_data: { product: p.product, currency, unit_amount: plans[tok.plan].today } }],
            } : {}),
            payment_behavior: "default_incomplete",
            payment_settings: { save_default_payment_method: "on_subscription" },
            metadata,
            expand: ["latest_invoice.confirmation_secret"],
          });
          subsByToken.set(req.params.token, sub.id);
        }
        const clientSecret = sub.latest_invoice?.confirmation_secret?.client_secret;
        if (!clientSecret) throw new Error(`no confirmation secret for ${sub.id} (${sub.status})`);
        res.json({ clientSecret, subscriptionId: sub.id });
      } catch (e) {
        console.error(JSON.stringify({ kind: "stripe_subscribe_error", error: e.message }));
        res.status(502).json({ error: "subscribe_failed" });
      }
    });

    app.post("/api/stripe/complete/:token", async (req, res) => {
      const tok = pay.read(req.params.token);
      if (!tok) return res.status(404).json({ error: "expired" });
      try {
        res.json(await finish(tok, String(req.body?.subscriptionId || "")));
      } catch (e) {
        console.error(JSON.stringify({ kind: "stripe_complete_error", error: e.message }));
        res.status(400).json({ error: "complete_failed" });
      }
    });

    // 3-D Secure and wallet redirects come back here.
    app.get("/pay/:token/return", async (req, res) => {
      const tok = pay.read(req.params.token);
      if (!tok) return res.redirect(302, "/");
      try {
        const r = await finish(tok, String(req.query.subscription || ""));
        res.redirect(302, r.paid ? r.redirect : `/pay/${req.params.token}?failed=1`);
      } catch {
        res.redirect(302, `/pay/${req.params.token}?failed=1`);
      }
    });

    app.post("/webhooks/stripe", express.raw({ type: "*/*" }), async (req, res) => {
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
      } catch {
        return res.status(400).send("bad signature");
      }
      res.json({ received: true });
      try {
        await onEvent(event);
      } catch (e) {
        console.error(JSON.stringify({ kind: "stripe_webhook_error", type: event.type, error: e.message }));
      }
    });
  }

  async function onEvent(event) {
    const o = event.data.object;
    if (event.type === "invoice.paid") {
      const subId = o.parent?.subscription_details?.subscription ?? o.subscription;
      if (!subId) return;
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub.metadata?.source !== source) return;
      if (o.billing_reason === "subscription_create") {
        const m = sub.metadata;
        await capi.send({
          event_name: "Purchase", event_id: `purchase_${sub.id}`, event_source_url: m.page || "",
          user_data: capi.user({ email: o.customer_email, externalId: m.uid || m.funnel_session, fbp: m.fbp, fbc: m.fbc, ip: m.ip, ua: m.ua }),
          custom_data: { currency: o.currency.toUpperCase(), value: o.amount_paid / 100, content_ids: [m.plan], order_id: sub.id, funnel: m.funnel || funnel },
        });
        console.log(JSON.stringify({ kind: "purchase", provider: "stripe", sub: sub.id, plan: m.plan, amount: o.amount_paid, funnel: m.funnel }));
      }
      return notify(sub.customer, o.customer_email);
    }
    if (event.type.startsWith("customer.subscription.") || event.type === "invoice.payment_failed") {
      const customer = o.customer;
      const meta = o.metadata?.source ? o.metadata : (await stripe.customers.retrieve(customer)).metadata;
      if (meta?.source !== source) return;
      return notify(customer, o.customer_email);
    }
  }

  return {
    name: "stripe",
    register,
    async customersByEmail(email) {
      const r = await stripe.customers.list({ email, limit: 20 });
      return r.data.filter((c) => ctx.sources.includes(c.metadata?.source)).map((c) => ({ id: c.id, email: c.email }));
    },
    async customer(id) {
      const c = await stripe.customers.retrieve(id);
      return c.deleted ? null : { id: c.id, email: c.email };
    },
    async subscriptionsFor(customerId) {
      const r = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
      return r.data.map(normalize);
    },
    async manageUrl(customerId, returnUrl) {
      const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return s.url;
    },
  };
}

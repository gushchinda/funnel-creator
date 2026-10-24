#!/usr/bin/env node
// Create (or find) the Stripe product, prices and intro coupons for a funnel, and optionally its webhook endpoint.
//
//   STRIPE_SECRET_KEY=sk_test_… node scripts/setup_stripe.mjs <funnel>/funnel.config.json
//   STRIPE_SECRET_KEY=sk_test_… node scripts/setup_stripe.mjs <funnel>/funnel.config.json --webhook https://<host>/webhooks/stripe
//
// Idempotent: product id = funnel source, prices by lookup_key, coupons by id. Writes <funnel>/server/provider-ids.json.
// Never touches existing objects it did not create. Run from <funnel>/server so the stripe package resolves.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const cfgPath = process.argv[2];
if (!cfgPath || !process.env.STRIPE_SECRET_KEY) {
  console.error("usage: STRIPE_SECRET_KEY=… setup_stripe.mjs <funnel.config.json> [--webhook <url>]");
  process.exit(1);
}
const dir = path.dirname(path.resolve(cfgPath));
const Stripe = createRequire(path.join(dir, "server", "package.json"))("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const source = config.source || config.slug;
const currency = config.payments.currency.toLowerCase();
const live = process.env.STRIPE_SECRET_KEY.includes("_live_");

const PERIOD = { d: "day", w: "week", m: "month", y: "year" };
const period = (p) => { const [, n, u] = /^(\d+)([dwmy])$/.exec(p); return { interval: PERIOD[u], interval_count: Number(n) }; };
const money = (c) => `${(c / 100).toFixed(2)} ${currency.toUpperCase()}`;

async function product() {
  try {
    return await stripe.products.retrieve(source);
  } catch {
    return stripe.products.create({ id: source, name: config.product.name, metadata: { source } });
  }
}

async function price(prod, p) {
  const lookup_key = `${source}_${p.id}_${p.renew}_${p.period}`;
  const found = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
  if (found.data[0]) return found.data[0];
  return stripe.prices.create({
    product: prod.id, currency, unit_amount: p.renew, recurring: period(p.period), lookup_key,
    nickname: `${p.label}: ${money(p.renew)} every ${p.period}`, metadata: { source, plan: p.id },
  });
}

async function coupon(p) {
  const id = `${source}_${p.id}_intro_${p.today}`;
  try {
    return await stripe.coupons.retrieve(id);
  } catch {
    return stripe.coupons.create({
      id, amount_off: p.renew - p.today, currency, duration: "once",
      name: `${p.label} intro ${money(p.today)}`, metadata: { source, plan: p.id },
    });
  }
}

console.log(`Stripe ${live ? "LIVE" : "test"} mode, source ${source}`);
const prod = await product();
const out = {};
for (const p of config.payments.plans) {
  const pr = await price(prod, p);
  const ids = { product: prod.id, price: pr.id };
  const trial = /^trial_(\d+)d_plus_fee$/.exec(p.intro || "");
  if (p.intro === "first_invoice_discount") {
    ids.coupon = (await coupon(p)).id;
    const preview = await stripe.invoices.createPreview({
      customer_details: { address: { country: "US" } },
      subscription_details: { items: [{ price: pr.id }] },
      discounts: [{ coupon: ids.coupon }],
    });
    const ok = preview.amount_due === p.today;
    console.log(`${p.id}: first invoice ${money(preview.amount_due)} ${ok ? "OK" : `!= paywall ${money(p.today)}`}`);
  } else if (trial) {
    ids.trialDays = Number(trial[1]);
    console.log(`${p.id}: ${money(p.today)} fee today + ${trial[1]}-day trial, then ${money(p.renew)} (check with a test card)`);
  } else {
    console.log(`${p.id}: ${money(p.renew)} every ${p.period}`);
  }
  out[p.id] = ids;
}

const idsFile = path.join(dir, "server", "provider-ids.json");
const all = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, "utf8")) : {};
all.stripe = out;
fs.writeFileSync(idsFile, JSON.stringify(all, null, 2) + "\n");
console.log(`wrote ${idsFile}`);

const i = process.argv.indexOf("--webhook");
if (i > 0) {
  const url = process.argv[i + 1];
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === url);
  if (existing) {
    console.log(`webhook for ${url} already exists (${existing.id}); its secret cannot be read again. Delete it and rerun to get a new one.`);
  } else {
    const w = await stripe.webhookEndpoints.create({
      url, metadata: { source },
      enabled_events: ["invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"],
    });
    // Printed once, for the operator to put into STRIPE_WEBHOOK_SECRET. Do not paste it into chat or files in git.
    console.log(`webhook ${w.id} created. STRIPE_WEBHOOK_SECRET=${w.secret}`);
  }
}

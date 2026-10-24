#!/usr/bin/env node
// Create (or find) the Paddle Billing product, prices and intro discounts for a funnel, and optionally its
// notification destination (webhook).
//
//   PADDLE_API_KEY=… PADDLE_ENV=sandbox node scripts/setup_paddle.mjs <funnel>/funnel.config.json
//   PADDLE_API_KEY=… PADDLE_ENV=sandbox node scripts/setup_paddle.mjs <funnel>/funnel.config.json --webhook https://<host>/webhooks/paddle
//
// Idempotent through custom_data (product: source, prices/discounts: funnel_plan). Writes <funnel>/server/provider-ids.json.
import fs from "node:fs";
import path from "node:path";

const cfgPath = process.argv[2];
const { PADDLE_API_KEY, PADDLE_ENV = "sandbox" } = process.env;
if (!cfgPath || !PADDLE_API_KEY) {
  console.error("usage: PADDLE_API_KEY=… PADDLE_ENV=sandbox|production setup_paddle.mjs <funnel.config.json> [--webhook <url>]");
  process.exit(1);
}
const BASE = PADDLE_ENV === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const source = config.source || config.slug;
const currency = config.payments.currency.toUpperCase();
const PERIOD = { d: "day", w: "week", m: "month", y: "year" };
const period = (p) => { const [, n, u] = /^(\d+)([dwmy])$/.exec(p); return { interval: PERIOD[u], frequency: Number(n) }; };

async function api(p, body, method = body ? "POST" : "GET") {
  const r = await fetch(BASE + p, {
    method, headers: { Authorization: `Bearer ${PADDLE_API_KEY}`, "Content-Type": "application/json", "Paddle-Version": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j.error)}`);
  return j.data;
}

async function findOrCreate(list, match, create) {
  return (await api(list)).find(match) || api(create.path, create.body);
}

console.log(`Paddle ${PADDLE_ENV}, source ${source}`);
const product = await findOrCreate(
  "/products?status=active&per_page=200", (p) => p.custom_data?.source === source,
  { path: "/products", body: { name: config.product.name, tax_category: "standard", custom_data: { source } } },
);
const prices = `/prices?product_id=${product.id}&status=active&per_page=200`;
const out = {};
for (const p of config.payments.plans) {
  const tag = `${p.id}_${p.renew}_${p.period}`;
  const trial = /^trial_(\d+)d_plus_fee$/.exec(p.intro || "");
  const recurring = await findOrCreate(prices, (x) => x.custom_data?.funnel_plan === tag, {
    path: "/prices",
    body: {
      product_id: product.id, description: `${p.label}: ${p.renew / 100} ${currency} every ${p.period}`, name: p.label,
      unit_price: { amount: String(p.renew), currency_code: currency }, billing_cycle: period(p.period),
      ...(trial ? { trial_period: { interval: "day", frequency: Number(trial[1]) } } : {}),
      custom_data: { funnel_plan: tag, source },
    },
  });
  const ids = { items: [{ priceId: recurring.id }] };
  if (trial) {
    const feeTag = `${p.id}_fee_${p.today}`;
    const fee = await findOrCreate(prices, (x) => x.custom_data?.funnel_plan === feeTag, {
      path: "/prices",
      body: {
        product_id: product.id, description: `${p.label}: first payment ${p.today / 100} ${currency}`, name: `${p.label} (first payment)`,
        unit_price: { amount: String(p.today), currency_code: currency }, custom_data: { funnel_plan: feeTag, source },
      },
    });
    ids.items.push({ priceId: fee.id });
    console.log(`${p.id}: ${p.today / 100} ${currency} fee + ${trial[1]}-day trial, then ${p.renew / 100} (VERIFY in sandbox that the fee is charged today)`);
  } else if (p.intro === "first_invoice_discount") {
    const dTag = `${p.id}_intro_${p.today}`;
    const d = await findOrCreate("/discounts?status=active&per_page=200", (x) => x.custom_data?.funnel_plan === dTag, {
      path: "/discounts",
      body: {
        description: `${p.label} intro ${p.today / 100} ${currency}`, type: "flat", amount: String(p.renew - p.today),
        currency_code: currency, recur: false, enabled_for_checkout: true, restrict_to: [recurring.id],
        custom_data: { funnel_plan: dTag, source },
      },
    });
    ids.discountId = d.id;
    console.log(`${p.id}: ${p.today / 100} ${currency} first payment, then ${p.renew / 100} every ${p.period}`);
  }
  out[p.id] = ids;
}

const idsFile = path.join(path.dirname(path.resolve(cfgPath)), "server", "provider-ids.json");
const all = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, "utf8")) : {};
all.paddle = out;
fs.writeFileSync(idsFile, JSON.stringify(all, null, 2) + "\n");
console.log(`wrote ${idsFile}`);

const i = process.argv.indexOf("--webhook");
if (i > 0) {
  const url = process.argv[i + 1];
  const existing = (await api("/notification-settings")).find((n) => n.destination === url);
  if (existing) {
    console.log(`notification destination for ${url} already exists (${existing.id}); its secret is in Paddle → Developer tools → Notifications.`);
  } else {
    const n = await api("/notification-settings", {
      description: `${source} funnel`, destination: url, type: "url", include_sensitive_fields: false,
      subscribed_events: ["transaction.completed", "subscription.created", "subscription.updated", "subscription.canceled",
        "subscription.past_due", "subscription.paused", "subscription.resumed"],
    });
    // Printed once, for the operator to put into PADDLE_WEBHOOK_SECRET. Do not paste it into chat or files in git.
    console.log(`notification destination ${n.id} created. PADDLE_WEBHOOK_SECRET=${n.endpoint_secret_key}`);
  }
}

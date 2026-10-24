// Plans come from funnel.config.json (payments.plans); provider ids from provider-ids.json, which
// scripts/setup_stripe.mjs / setup_paddle.mjs write. Plan ids must match the plan ids in web/steps.json.
import fs from "node:fs";

const read = (rel) => {
  const file = new URL(rel, import.meta.url);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const config = read("../funnel.config.json");
if (!config) throw new Error("funnel.config.json not found next to server/");
const ids = read("./provider-ids.json") || {};

export const CONFIG = config;
export const CURRENCY = config.payments.currency.toLowerCase();

// { week: { label, terms, today, renew, period, intro, stripe: {price, coupon|trialDays, product}, paddle: {items, discountId} } }
export const PLANS = Object.fromEntries(config.payments.plans.map((p) => [p.id, {
  ...p,
  stripe: ids.stripe?.[p.id] || {},
  paddle: ids.paddle?.[p.id] || { items: [] },
}]));

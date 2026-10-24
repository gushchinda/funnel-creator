#!/usr/bin/env node
// Send the funnel's welcome email once, without a purchase, to check the provider key, sender and layout.
//   node scripts/send_test_email.mjs <funnel-folder> <to-email> [plan-id]
// Reads EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_SUBJECT and BASE_URL from the environment.
// The Open button and Manage link use a throwaway token: Open falls back to the store, Manage says "Link expired".
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const [dir, to, planId] = process.argv.slice(2);
if (!dir || !to?.includes("@")) {
  console.error("usage: node scripts/send_test_email.mjs <funnel-folder> <to-email> [plan-id]");
  process.exit(2);
}
const root = path.resolve(dir);
const config = JSON.parse(fs.readFileSync(path.join(root, "funnel.config.json"), "utf8"));
const { mailer } = await import(pathToFileURL(path.join(root, "server/lib/email.js")));
const { tokens } = await import(pathToFileURL(path.join(root, "server/lib/tokens.js")));

const plan = config.payments.plans.find((p) => p.id === planId) || config.payments.plans[0];
const m = mailer({ env: process.env, config });
if (!m.on) {
  console.error("email is off: set EMAIL_PROVIDER (resend|postmark|sendgrid), EMAIL_API_KEY and EMAIL_FROM");
  process.exit(1);
}
const token = tokens(crypto.randomBytes(32).toString("base64")).make({ p: config.payments.provider, c: "cus_test", e: to });
const ok = await m.welcome({ order: `test_${Date.now()}`, email: to, plan, accessToken: token, baseUrl: process.env.BASE_URL });
process.exit(ok ? 0 : 1);

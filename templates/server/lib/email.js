// Welcome ("introduction") email after the first payment: how to open the app, what was bought, how to manage it.
// One HTTP call to the provider the user picked at first run (Resend, Postmark or SendGrid); no SDK, no database.
// Template: server/emails/welcome.html with {{placeholders}}. See references/email.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "emails");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PROVIDERS = {
  // Resend keeps an Idempotency-Key for 24 h, so a second instance sending the same welcome is dropped.
  resend: (key, m) => ["https://api.resend.com/emails", { Authorization: `Bearer ${key}`, "Idempotency-Key": m.id }, {
    from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}),
  }],
  postmark: (key, m) => ["https://api.postmarkapp.com/email", { "X-Postmark-Server-Token": key, Accept: "application/json" }, {
    From: m.from, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, MessageStream: "outbound",
    ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
  }],
  sendgrid: (key, m) => ["https://api.sendgrid.com/v3/mail/send", { Authorization: `Bearer ${key}` }, {
    personalizations: [{ to: [{ email: m.to }] }], from: parseFrom(m.from), subject: m.subject,
    content: [{ type: "text/plain", value: m.text }, { type: "text/html", value: m.html }],
    ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}),
  }],
};
function parseFrom(from) {
  const m = /^(.*)<(.+)>$/.exec(from.trim());
  return m ? { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() } : { email: from.trim() };
}

export function mailer({ env, config }) {
  const provider = (env.EMAIL_PROVIDER || "").toLowerCase();
  const on = Boolean(PROVIDERS[provider] && env.EMAIL_API_KEY && env.EMAIL_FROM);
  const product = config.product || {};
  const links = product.after_purchase || {};
  const sent = new Set(); // this instance already sent these orders

  // vars: { order, email, plan: {label, terms}, accessToken, baseUrl }
  async function welcome(v) {
    if (!on || !v.email || sent.has(v.order)) return false;
    sent.add(v.order);
    // Mail apps drop custom-scheme links, so the button goes through /open/<token>, which tries the app and falls
    // back to the stores.
    const open = v.baseUrl && links.deep_link ? `${v.baseUrl}/open/${v.accessToken}` : "";
    const data = {
      app: product.name || config.slug, plan: v.plan?.label || "", terms: v.plan?.terms || "",
      open_url: open || links.ios || links.android || "", ios_url: links.ios || "", android_url: links.android || "",
      manage_url: v.baseUrl ? `${v.baseUrl}/manage/${v.accessToken}` : "", email: v.email,
      support: product.legal?.support_email || env.EMAIL_REPLY_TO || "", terms_url: product.legal?.terms || "",
    };
    const fill = (tpl, html) => tpl
      .replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_, k, inner) => (data[k] ? inner : "")) // {{#ios_url}}…{{/ios_url}}
      .replace(/{{(\w+)}}/g, (_, k) => (html ? esc(data[k]) : String(data[k] ?? "")));
    const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
    const subject = fill(env.EMAIL_SUBJECT || "Welcome to {{app}}: your plan is active", false);
    const [url, headers, body] = PROVIDERS[provider](env.EMAIL_API_KEY, {
      id: `welcome_${v.order}`, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO, to: v.email, subject,
      html: fill(read("welcome.html"), true), text: fill(read("welcome.txt"), false),
    });
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`${provider} ${r.status} ${(await r.text()).slice(0, 200)}`);
      console.log(JSON.stringify({ kind: "email_sent", template: "welcome", order: v.order, provider }));
      return true;
    } catch (e) {
      sent.delete(v.order);
      console.error(JSON.stringify({ kind: "email_error", template: "welcome", order: v.order, error: e.message }));
      return false;
    }
  }

  return { on, welcome };
}

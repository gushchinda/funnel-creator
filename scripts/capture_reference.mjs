#!/usr/bin/env node
// Walk a reference quiz funnel in a phone-sized headless Chromium and record every step.
//
//   node scripts/capture_reference.mjs <url> --out <funnel>/reference [--max-steps 80] [--actions actions.json] [--headful]
//
// Per step: steps/NN-<slug>.png (viewport), NN-<slug>-full.png (full page), NN-<slug>.json (texts, buttons,
// inputs, url), NN-<slug>.html (body HTML). Also tokens.json (computed styles) and network.txt (third parties,
// Meta Pixel events). The walk answers with the first option, fills inputs with test values and presses the
// main button; give explicit actions for steps it gets wrong:
//   { "7": [{"click": "text=Female"}], "19": [{"fill": ["input[type=number]", "70"]}, {"click": "text=Continue"}] }
// Needs the playwright package (npm i -D playwright) and a Chromium it can find.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1]; };
const url = argv.find((a) => /^https?:\/\//.test(a));
if (!url) { console.error("usage: capture_reference.mjs <url> --out <dir>"); process.exit(1); }
const OUT = opt("out", "reference");
const MAX = Number(opt("max-steps", 80));
const ACTIONS = opt("actions") ? JSON.parse(fs.readFileSync(opt("actions"), "utf8")) : {};
fs.mkdirSync(path.join(OUT, "steps"), { recursive: true });

const CTA = /^(continue|next|get started|start|start quiz|got it|submit|ok|okay|let'?s go|i'?m ready|see (my )?(plan|results?)|show|take the quiz|yes|confirm|done)\b/i;
const COOKIES = /^(accept( all)?|agree|allow( all)?|got it|i agree)$/i;
const PAYWALL = /(\/\s?(week|wk|month|mo|year)|per (week|month|day)|billed|today|money-back|get my plan|start (my )?trial)/i;

const browser = await chromium.launch({ headless: !argv.includes("--headful") });
const context = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const origin = new URL(url).hostname;
const network = new Map();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.hostname.endsWith(origin)) return;
  const pixel = u.hostname.includes("facebook.com") && u.pathname === "/tr" ? ` ev=${u.searchParams.get("ev")}` : "";
  const key = `${u.hostname}${u.pathname.split("/").slice(0, 3).join("/")}${pixel}`;
  network.set(key, (network.get(key) || 0) + 1);
});

const settle = async () => {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(900);
};
const slugify = (s) => (s || "step").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "step";

async function describe() {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const txt = (el) => (el.innerText || el.value || "").trim().replace(/\s+/g, " ");
    const heading = [...document.querySelectorAll("h1,h2,h3,[class*=title],[class*=question]")].filter(vis).map(txt).find(Boolean) || "";
    const clickables = [...document.querySelectorAll("button,[role=button],[role=radio],[role=checkbox],label,a,li,[class*=option],[class*=answer],[class*=card]")]
      .filter(vis).map((el) => ({ tag: el.tagName.toLowerCase(), text: txt(el).slice(0, 120) })).filter((c) => c.text);
    const inputs = [...document.querySelectorAll("input,select,textarea")].filter(vis)
      .map((el) => ({ type: el.type || el.tagName.toLowerCase(), name: el.name, placeholder: el.placeholder || "" }));
    return { url: location.href, heading, text: document.body.innerText.trim(), clickables, inputs };
  });
}

async function tokens() {
  return page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, color: s.color, bg: s.backgroundColor,
        radius: s.borderRadius, border: s.border, padding: s.padding, shadow: s.boxShadow };
    };
    const q = (sel) => [...document.querySelectorAll(sel)].find((el) => el.getBoundingClientRect().width > 0);
    return {
      body: pick(document.body), h1: pick(q("h1,h2")), button: pick(q("button")),
      option: pick(q("[role=radio],[class*=option],[class*=answer],label")), input: pick(q("input")),
      progress: pick(q("[role=progressbar],[class*=progress]")),
      fonts: [...new Set([...document.querySelectorAll("link[href*='fonts']")].map((l) => l.href))],
    };
  });
}

async function act(step, d) {
  if (ACTIONS[step]) {
    for (const a of ACTIONS[step]) {
      if (a.click) await page.locator(a.click).first().click({ timeout: 5000 });
      if (a.fill) await page.locator(a.fill[0]).first().fill(String(a.fill[1]));
      if (a.wait) await page.waitForTimeout(a.wait);
    }
    return;
  }
  for (const [i, inp] of d.inputs.entries()) {
    const el = page.locator("input:visible,textarea:visible").nth(i);
    const hint = `${inp.type} ${inp.name} ${inp.placeholder}`.toLowerCase();
    const value = /mail/.test(hint) ? "test+ref@example.com" : /age|year/.test(hint) ? "35" : /height|cm/.test(hint) ? "175"
      : /weight|kg|lb/.test(hint) ? "75" : inp.type === "number" ? "35" : /name/.test(hint) ? "Alex" : null;
    if (value && !["checkbox", "radio", "range"].includes(inp.type)) await el.fill(value).catch(() => {});
    if (inp.type === "checkbox") await el.check().catch(() => {});
  }
  const cta = d.clickables.find((c) => CTA.test(c.text));
  const option = d.clickables.find((c) => !CTA.test(c.text) && !/back|skip|privacy|terms|policy|log ?in|sign ?in/i.test(c.text) && c.text.length < 80);
  if (option && !d.inputs.some((i) => /mail|text|number/.test(i.type))) await page.getByText(option.text, { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  if (cta) await page.getByText(cta.text, { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
}

await page.goto(url, { waitUntil: "domcontentloaded" });
let step = 0, last = "", stuck = 0;
const flow = [];
for (let tries = 0; tries < MAX * 3 && step < MAX; tries++) {
  await settle();
  const cookie = page.getByRole("button", { name: COOKIES }).first();
  if (await cookie.isVisible().catch(() => false)) { await cookie.click().catch(() => {}); await settle(); }
  const d = await describe();
  const print = crypto.createHash("sha1").update(d.text).digest("hex");
  if (print === last) {
    // Same screen after acting: retry the step's actions, then give up and ask for explicit actions.
    if (++stuck >= 3) { console.log(`stuck after step ${step}; add actions for step ${step} and rerun`); break; }
    await act(step, d);
    continue;
  }
  stuck = 0; last = print; step++;

  const name = `${String(step).padStart(2, "0")}-${slugify(d.heading)}`;
  await page.screenshot({ path: path.join(OUT, "steps", `${name}.png`) });
  await page.screenshot({ path: path.join(OUT, "steps", `${name}-full.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, "steps", `${name}.json`), JSON.stringify(d, null, 2));
  fs.writeFileSync(path.join(OUT, "steps", `${name}.html`), await page.evaluate(() => document.body.outerHTML));
  flow.push(`| ${step} | ${slugify(d.heading)} | | ${d.heading.replace(/\|/g, "/")} | | |`);
  if (step === 1) fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify({ landing: await tokens() }, null, 2));
  console.log(`${name}  ${d.url}`);

  const prices = (d.text.match(/[$€£]\s?\d+[.,]?\d*/g) || []).length;
  if (prices >= 2 && PAYWALL.test(d.text)) {
    const t = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8"));
    t.paywall = await tokens();
    fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(t, null, 2));
    console.log("paywall reached; capture plans, timer and exit popups by hand (see references/reference-capture.md)");
    break;
  }
  await act(step, d);
}

fs.writeFileSync(path.join(OUT, "network.txt"), [...network].sort().map(([k, n]) => `${n}\t${k}`).join("\n") + "\n");
if (!fs.existsSync(path.join(OUT, "flow.md"))) {
  fs.writeFileSync(path.join(OUT, "flow.md"), `# Reference flow: ${url}\n\n| # | Slug | Type | Content | Interaction | Notes |\n|---|---|---|---|---|---|\n${flow.join("\n")}\n`);
}
await browser.close();

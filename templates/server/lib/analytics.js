// Funnel analytics without a database. Every event is one structured log line (kind "funnel_event"); a Cloud
// Logging sink copies those lines into BigQuery (scripts/setup_analytics.sh), and /analytics reads them back as a
// step-by-step funnel. Events: step_view (browser, via FunnelBridge.track), lead, checkout, purchase (server).
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BigQuery } from "@google-cloud/bigquery";

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "analytics.html");
const str = (v, max = 100) => (typeof v === "string" ? v.slice(0, max) : "");

export function analytics({ app, env, funnel }) {
  const password = env.ANALYTICS_PASSWORD || "";
  const dataset = env.ANALYTICS_DATASET || "funnel_analytics";
  const table = env.ANALYTICS_TABLE || "run_googleapis_com_stdout";
  let bq;

  // Every field always has the same type, so the BigQuery table schema never conflicts.
  function log(event, f = {}) {
    console.log(JSON.stringify({
      kind: "funnel_event", funnel, event,
      session: str(f.session, 80), step: str(f.step, 60), idx: Number.isInteger(f.idx) ? f.idx : -1,
      plan: str(f.plan, 40), amount: Number.isInteger(f.amount) ? f.amount : 0, currency: str(f.currency, 3).toUpperCase(),
      order_id: str(f.order, 80), utm_source: str(f.utm?.source), utm_campaign: str(f.utm?.campaign), utm_content: str(f.utm?.content),
    }));
  }
  // One line per cold start creates every column in BigQuery before the first real event needs it.
  log("server_start");

  app.post("/api/events", (req, res) => {
    const b = req.body || {};
    if (b.event !== "step_view" || !/^[\w-]{4,80}$/.test(b.session_id || "") || !/^[\w-]{1,60}$/.test(b.step || "")) {
      return res.status(400).json({ error: "bad_request" });
    }
    log("step_view", { session: b.session_id, step: b.step, idx: Number.isInteger(b.index) ? b.index : -1, utm: b.utm || {} });
    res.status(204).end();
  });

  function authorized(req) {
    const [scheme, value] = (req.get("authorization") || "").split(" ");
    if (!password || scheme !== "Basic" || !value) return false;
    const given = Buffer.from(Buffer.from(value, "base64").toString().split(":").slice(1).join(":"));
    const want = Buffer.from(password);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }
  function guard(req, res, next) {
    if (!password) return res.status(404).send("Analytics is off: set ANALYTICS_PASSWORD");
    if (authorized(req)) return next();
    res.set("WWW-Authenticate", 'Basic realm="Funnel analytics", charset="UTF-8"').status(401).send("Password required");
  }

  app.get("/analytics", guard, (_req, res) => res.set("Cache-Control", "no-store").sendFile(PAGE));

  app.get("/api/analytics", guard, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
    const source = str(req.query.source);
    try {
      bq ||= new BigQuery();
      const project = env.GOOGLE_CLOUD_PROJECT || await bq.getProjectId();
      res.set("Cache-Control", "no-store").json(await report(`\`${project}.${dataset}.${table}\``, { funnel, days, source }));
    } catch (e) {
      const empty = /Not found: Table|Unrecognized name/.test(e.message);
      if (!empty) console.error(JSON.stringify({ kind: "analytics_error", error: e.message }));
      res.status(empty ? 200 : 502).json(empty ? { empty: true, days, source } : { error: "query_failed" });
    }
  });

  async function report(t, params) {
    // Sessions keep the first utm_source they arrived with; a filter applies to the whole session.
    const base = `
      WITH raw AS (
        SELECT timestamp AS ts, jsonPayload.event AS event, jsonPayload.session AS session, jsonPayload.step AS step,
               CAST(jsonPayload.idx AS INT64) AS idx, jsonPayload.plan AS plan, CAST(jsonPayload.amount AS INT64) AS amount,
               jsonPayload.currency AS currency, jsonPayload.utm_source AS src
        FROM ${t}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
          AND jsonPayload.kind = 'funnel_event' AND jsonPayload.funnel = @funnel AND jsonPayload.session != ''
      ),
      sessions AS (
        SELECT session, IFNULL(ARRAY_AGG(NULLIF(src, '') IGNORE NULLS ORDER BY ts LIMIT 1)[SAFE_OFFSET(0)], '(direct)') AS src,
               MIN(ts) AS first_ts
        FROM raw GROUP BY session
      ),
      e AS (SELECT raw.*, s.src AS source, s.first_ts FROM raw JOIN sessions s USING (session)
            WHERE @source = '' OR s.src = @source),
      purchases AS (SELECT session, ANY_VALUE(plan) AS plan, MAX(amount) AS amount, ANY_VALUE(currency) AS currency,
                           ANY_VALUE(source) AS source, MIN(ts) AS ts
                    FROM e WHERE event = 'purchase' GROUP BY session)`;
    const q = (sql) => bq.query({ query: base + sql, params }).then(([rows]) => rows);
    const [steps, totals, plans, sources, daily] = await Promise.all([
      q(`SELECT step, MIN(idx) AS idx, COUNT(DISTINCT session) AS sessions FROM e
         WHERE event = 'step_view' GROUP BY step ORDER BY idx, step`),
      q(`SELECT
           (SELECT COUNT(DISTINCT session) FROM e) AS visitors,
           (SELECT COUNT(DISTINCT session) FROM e WHERE event = 'lead') AS leads,
           (SELECT COUNT(DISTINCT session) FROM e WHERE event = 'checkout') AS checkouts,
           (SELECT COUNT(*) FROM purchases) AS purchases,
           (SELECT IFNULL(SUM(amount), 0) FROM purchases) AS revenue,
           (SELECT ANY_VALUE(currency) FROM purchases) AS currency`),
      q(`SELECT plan, c.checkouts, IFNULL(p.purchases, 0) AS purchases, IFNULL(p.revenue, 0) AS revenue
         FROM (SELECT plan, COUNT(DISTINCT session) AS checkouts FROM e WHERE event = 'checkout' GROUP BY plan) c
         FULL JOIN (SELECT plan, COUNT(*) AS purchases, SUM(amount) AS revenue FROM purchases GROUP BY plan) p USING (plan)
         ORDER BY checkouts DESC`),
      q(`SELECT source, v.visitors, v.leads, IFNULL(p.purchases, 0) AS purchases, IFNULL(p.revenue, 0) AS revenue
         FROM (SELECT source, COUNT(DISTINCT session) AS visitors, COUNT(DISTINCT IF(event = 'lead', session, NULL)) AS leads
               FROM e GROUP BY source) v
         LEFT JOIN (SELECT source, COUNT(*) AS purchases, SUM(amount) AS revenue FROM purchases GROUP BY source) p USING (source)
         ORDER BY visitors DESC LIMIT 20`),
      q(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(s.first_ts)) AS day, COUNT(*) AS visitors, COUNTIF(p.session IS NOT NULL) AS purchases
         FROM (SELECT DISTINCT session, first_ts FROM e) s LEFT JOIN purchases p USING (session)
         GROUP BY day ORDER BY day`),
    ]);
    return { funnel: params.funnel, days: params.days, source: params.source, totals: totals[0], steps, plans, sources, daily };
  }

  return { log };
}

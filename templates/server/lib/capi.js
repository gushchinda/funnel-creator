// Meta Conversions API. Every event here has a browser twin with the same event_id (see web/funnel-bridge.js).
import crypto from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

export function capi({ pixelId, token, testCode, funnel }) {
  const sent = new Map(); // event_id -> time, so retries and webhook redeliveries do not double count

  async function send(event) {
    if (!pixelId || !token) return;
    const now = Date.now();
    if (sent.has(event.event_id)) return;
    sent.set(event.event_id, now);
    for (const [id, t] of sent) if (now - t > 48 * 3600e3) sent.delete(id);

    const body = {
      data: [{
        event_time: Math.floor(now / 1000), action_source: "website", ...event,
        custom_data: { funnel, ...event.custom_data },
      }],
      ...(testCode ? { test_event_code: testCode } : {}),
    };
    try {
      const r = await fetch(`${GRAPH}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) console.error(JSON.stringify({ kind: "capi_error", event: event.event_name, status: r.status, body: await r.text() }));
    } catch (e) {
      console.error(JSON.stringify({ kind: "capi_error", event: event.event_name, error: String(e) }));
    }
  }

  // u: { email, externalId, fbp, fbc, ip, ua }
  const user = (u) => ({
    ...(u.email ? { em: [sha(u.email)] } : {}),
    ...(u.externalId ? { external_id: [sha(u.externalId)] } : {}),
    ...(u.fbp ? { fbp: u.fbp } : {}),
    ...(u.fbc ? { fbc: u.fbc } : {}),
    ...(u.ip ? { client_ip_address: u.ip } : {}),
    ...(u.ua ? { client_user_agent: u.ua } : {}),
  });

  return { send, user };
}

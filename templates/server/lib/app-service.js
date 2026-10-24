// Hands web purchases to the subscription service the mobile app already uses (Adapty, RevenueCat, Apphud), so
// the app unlocks premium through its usual SDK call. Two parts: metadata keys the service reads from Stripe
// objects, and (Adapty, RevenueCat) one API call after the first payment that attaches the subscription to the
// app user right away. See references/app-services.md.
export function appService({ env }) {
  const name = (env.APP_SERVICE || "none").toLowerCase();
  // The id the app passes to the service SDK (Adapty.identify, Purchases.logIn, Apphud.start userID):
  // the ?uid= the app opened the funnel with, or the email when the app identifies users by email.
  const userId = (tok) => (env.APP_USER_ID_FROM === "email" ? tok.email?.trim().toLowerCase() : tok.uid) || "";

  // Extra metadata on the Stripe customer and subscription (Paddle: custom_data).
  function meta(tok) {
    const id = userId(tok);
    if (!id) return {};
    if (name === "adapty") return { customer_user_id: id };
    if (name === "apphud") return { apphud_user_id: id, ...(env.APPHUD_CLIENT_ID ? { apphud_client_id: env.APPHUD_CLIENT_ID } : {}) };
    if (name === "revenuecat") return { app_user_id: id };
    return {};
  }

  const CALLS = {
    adapty: (id, sub) => env.ADAPTY_SECRET_KEY && ["https://api.adapty.io/api/v1/sdk/purchase/stripe/token/validate/", {
      Authorization: `Api-Key ${env.ADAPTY_SECRET_KEY}`, "Content-Type": "application/vnd.api+json",
    }, { data: { type: "stripe_receipt_validation_result", attributes: { customer_user_id: id, stripe_token: sub } } }],
    revenuecat: (id, sub) => env.REVENUECAT_STRIPE_PUBLIC_KEY && ["https://api.revenuecat.com/v1/receipts", {
      Authorization: `Bearer ${env.REVENUECAT_STRIPE_PUBLIC_KEY}`, "X-Platform": "stripe", "Content-Type": "application/json",
    }, { app_user_id: id, fetch_token: sub }],
  };

  // After the first payment (Stripe only; for Paddle the services read custom_data through their own integration).
  async function purchased({ provider, subscriptionId, uid, email }) {
    const id = userId({ uid, email });
    const call = provider === "stripe" && id && CALLS[name]?.(id, subscriptionId);
    if (!call) return;
    const [url, headers, body] = call;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        if (r.ok) return console.log(JSON.stringify({ kind: "app_service_synced", service: name, sub: subscriptionId }));
        throw Object.assign(new Error(`${name} ${r.status} ${(await r.text()).slice(0, 200)}`), { final: r.status < 500 });
      } catch (e) {
        if (e.final || attempt === 2) return console.error(JSON.stringify({ kind: "app_service_error", service: name, sub: subscriptionId, error: e.message }));
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  return { name, meta, purchased };
}

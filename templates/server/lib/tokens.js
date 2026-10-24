// Signed, stateless tokens: base64url(JSON) + "." + HMAC-SHA256. Used for pay links (/pay/<token>, 48 h)
// and for per-user access tokens the app keeps (no expiry; rotate the secret to revoke all).
import crypto from "node:crypto";

export function tokens(secret) {
  if (!secret || secret.length < 32) throw new Error("token secret must be at least 32 characters");
  const sign = (body) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

  return {
    make(payload) {
      const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString("base64url");
      return `${body}.${sign(body)}`;
    },
    read(token, maxAgeMs = Infinity) {
      const [body, mac] = String(token || "").split(".");
      if (!body || !mac) return null;
      const want = sign(body);
      if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
      try {
        const p = JSON.parse(Buffer.from(body, "base64url").toString());
        return Date.now() - p.t <= maxAgeMs ? p : null;
      } catch {
        return null;
      }
    },
  };
}

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

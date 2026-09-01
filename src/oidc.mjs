import crypto from "node:crypto";

function decodePart(value) {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new Error("invalid_jwt"); }
}

let cache = { until: 0, keys: [] };

async function remoteKeys(issuer) {
  if (cache.until > Date.now() && cache.keys.length) return cache.keys;
  const endpoint = new URL("/.well-known/jwks", issuer);
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "oidc.vercel.com") throw new Error("invalid_oidc_issuer");
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.keys) || !body.keys.length) throw new Error("jwks_unavailable");
  cache = { until: Date.now() + 10 * 60_000, keys: body.keys };
  return cache.keys;
}

export async function verifyVercelOidc(token, config, keyLoader = remoteKeys) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error("invalid_jwt");
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string") throw new Error("invalid_jwt_header");
  const keys = await keyLoader(config.issuer);
  const jwk = keys.find(item => item?.kid === header.kid && item?.kty === "RSA" && (!item.alg || item.alg === "RS256"));
  if (!jwk) throw new Error("unknown_jwt_key");
  let publicKey;
  try { publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" }); }
  catch { throw new Error("invalid_jwt_key"); }
  const valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"));
  if (!valid) throw new Error("invalid_jwt_signature");

  const now = Math.floor(Date.now() / 1000), tolerance = 5;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== config.issuer || !audiences.includes(config.audience) || payload.sub !== config.subject) throw new Error("wrong_oidc_scope");
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.nbf) || !Number.isFinite(payload.exp)) throw new Error("invalid_jwt_time");
  if (payload.iat > now + tolerance || payload.nbf > now + tolerance || payload.exp <= now - tolerance) throw new Error("invalid_jwt_time");
  // Vercel-projecttokens hebben momenteel een levensduur van twaalf uur. Een token kan
  // desondanks maar één provisioning starten: server.mjs vereist een jti en bewaart die
  // atomair in de replay-store. Dertien uur is alleen een strakke bovengrens op de issuer.
  if (payload.exp - payload.iat > 13 * 60 * 60 + tolerance) throw new Error("invalid_jwt_lifetime");
  return payload;
}

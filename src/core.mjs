import crypto from "node:crypto";

const RESERVED = new Set([
  "api", "app", "admin", "assets", "auth", "beheer", "blog", "cdn", "demo",
  "docs", "help", "hermes", "login", "mail", "os", "socialnow", "status",
  "support", "vercel", "www",
]);

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function validateProvisionRequest(input, idempotencyKey) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_request");
  const allowed = new Set(["requestId", "slug", "company", "ownerEmail", "ownerName", "country", "language", "sector"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("unknown_field");

  const requestId = clean(input.requestId, 80);
  const slug = clean(input.slug, 40).toLowerCase();
  const company = clean(input.company, 120);
  const ownerEmail = clean(input.ownerEmail, 254).toLowerCase();
  const ownerName = clean(input.ownerName, 80);
  const country = clean(input.country, 2).toUpperCase();
  const language = clean(input.language, 2).toLowerCase() === "en" ? "en" : "nl";
  const sector = clean(input.sector, 60).toLowerCase() || "dienstverlening";

  if (!/^am_[a-z0-9_]{6,70}$/.test(requestId)) throw new Error("invalid_request_id");
  if (clean(idempotencyKey, 80) !== requestId) throw new Error("idempotency_mismatch");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(slug) || RESERVED.has(slug)) throw new Error("invalid_slug");
  if (company.length < 2 || ownerName.length < 2) throw new Error("missing_identity");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) throw new Error("invalid_email");
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("invalid_country");
  if (!/^[a-z0-9-]{2,60}$/.test(sector)) throw new Error("invalid_sector");

  return { requestId, slug, company, ownerEmail, ownerName, country, language, sector };
}

export function decodeEncryptionKey(value) {
  const raw = String(value || "").trim();
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new Error("invalid_queue_encryption_key");
  return key;
}

export function encryptRequest(request, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : decodeEncryptionKey(keyValue);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(request));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    requestId: request.requestId,
    slug: request.slug,
    receivedAt: new Date().toISOString(),
    algorithm: "A256GCM",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptRequest(envelope, keyValue) {
  if (envelope?.version !== 1 || envelope?.algorithm !== "A256GCM") throw new Error("invalid_envelope");
  const key = Buffer.isBuffer(keyValue) ? keyValue : decodeEncryptionKey(keyValue);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8"));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}


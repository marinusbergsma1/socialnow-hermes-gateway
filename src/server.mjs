import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeEncryptionKey, encryptRequest, sha256, validateProvisionRequest } from "./core.mjs";
import { FileQueue } from "./file-queue.mjs";
import { verifyVercelOidc } from "./oidc.mjs";

const VERSION = "2026.09.01-1";
const port = Math.max(1, Math.min(65535, Number(process.env.PORT || 3000)));
const dataDir = process.env.DATA_DIR || "/data";
const issuer = String(process.env.VERCEL_OIDC_ISSUER || "").replace(/\/$/, "");
const audience = String(process.env.VERCEL_OIDC_AUDIENCE || "");
const projectId = String(process.env.VERCEL_PROJECT_ID || "");
const ownerId = String(process.env.VERCEL_OWNER_ID || "");
const expectedSubject = String(process.env.VERCEL_OIDC_SUBJECT || "");
const encryptionKey = decodeEncryptionKey(process.env.QUEUE_ENCRYPTION_KEY);

if (!issuer.startsWith("https://oidc.vercel.com") || !audience.startsWith("https://") || !projectId || !ownerId || !expectedSubject) {
  throw new Error("oidc_configuration_missing");
}

const oidcConfig = { issuer, audience, projectId, ownerId, subject: expectedSubject };
const queue = new FileQueue({ dataDir });
const hits = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  });
  res.end(JSON.stringify(body));
}

function limited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const minute = Math.floor(Date.now() / 60_000);
  const key = `${ip}:${minute}`;
  const count = (hits.get(key) || 0) + 1;
  hits.set(key, count);
  if (hits.size > 500) for (const entry of hits.keys()) if (!entry.endsWith(`:${minute}`)) hits.delete(entry);
  return count > 30;
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 32_768) throw new Error("body_too_large");
  }
  return JSON.parse(raw || "{}");
}

async function authenticate(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+([^\s]+)$/);
  if (!match) throw new Error("missing_bearer");
  const payload = await verifyVercelOidc(match[1], oidcConfig);
  if (payload.project_id !== projectId || payload.owner_id !== ownerId || payload.environment !== "production") {
    throw new Error("wrong_oidc_scope");
  }
  if (!payload.jti || typeof payload.jti !== "string") throw new Error("missing_jti");
  const replayDir = path.join(dataDir, "replay");
  await fs.mkdir(replayDir, { recursive: true });
  const replayFile = path.join(replayDir, `${sha256(payload.jti)}.used`);
  await fs.writeFile(replayFile, String(payload.exp || ""), { flag: "wx", mode: 0o600 });
  return payload;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { ok: true, service: "hermes-provisioner", version: VERSION });
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/provision") {
      json(res, 404, { ok: false });
      return;
    }
    if (limited(req)) { json(res, 429, { ok: false, error: "rate_limited" }); return; }
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      json(res, 415, { ok: false, error: "json_required" }); return;
    }
    await authenticate(req);
    const request = validateProvisionRequest(await body(req), req.headers["idempotency-key"]);
    const queued = await queue.enqueue(encryptRequest(request, encryptionKey));
    console.log(JSON.stringify({ event: queued.existing ? "already_queued" : "queued", requestId: request.requestId, slug: request.slug }));
    json(res, queued.existing ? 200 : 202, {
      ok: true,
      status: queued.existing ? "already_queued" : "queued",
      requestId: request.requestId,
      siteUrl: `https://${request.slug}.socialnow.nl`,
    });
  } catch (error) {
    const code = String(error?.message || "error").split(":")[0];
    const client = new Set([
      "body_too_large", "idempotency_mismatch", "invalid_country", "invalid_email",
      "invalid_request", "invalid_request_id", "invalid_sector", "invalid_slug",
      "missing_identity", "unknown_field",
    ]).has(code);
    const auth = code.includes("jwt") || code.includes("oidc") || code.includes("bearer") || code.includes("jti") || error?.code === "EEXIST";
    console.error(JSON.stringify({ event: "rejected", code: auth ? "authentication_failed" : client ? code : "internal_error" }));
    json(res, auth ? 401 : client ? 400 : 503, { ok: false, error: auth ? "unauthorized" : client ? code : "temporarily_unavailable" });
  }
});

server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 5_000;
server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ event: "started", version: VERSION, port })));

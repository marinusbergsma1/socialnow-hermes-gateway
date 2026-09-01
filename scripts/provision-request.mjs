import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptRequest, validateProvisionRequest } from "../src/core.mjs";
import { buildCustomerModule, callbackSignature, createOwnerInvite, inviteExpiry, replacePublicPlaceholders } from "../src/provisioning.mjs";

const [command, requestFile] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
const factory = path.join(root, "_factory");
const stateFile = path.join(process.env.RUNNER_TEMP || "/tmp", "socialnow-hermes-provision-state.json");

function required(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${bin} failed (${result.status}): ${String(result.stderr || result.stdout || "").slice(-1200)}`);
  return result.stdout;
}

function vercel(args, options = {}) {
  return run("vercel", [...args, "--scope", required("VERCEL_TEAM_SLUG"), "--token", required("VERCEL_TOKEN"), "--no-color"], options);
}

function env(name, value, cwd) {
  vercel(["env", "add", name, "production", "--force", "--sensitive", "--yes"], { cwd, input: `${value}\n` });
}

function loadRequest() {
  if (!/^requests\/am_[a-z0-9_]{6,70}\.json$/.test(String(requestFile || ""))) throw new Error("invalid_request_file");
  const envelope = JSON.parse(fs.readFileSync(path.join(root, requestFile), "utf8"));
  const request = decryptRequest(envelope, required("QUEUE_ENCRYPTION_KEY"));
  return validateProvisionRequest(request, request.requestId);
}

function loadState() {
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

if (command === "prepare") {
  const request = loadRequest();
  const firebase = { projectId: required("FIREBASE_PROJECT_ID"), apiKey: required("FIREBASE_WEB_API_KEY") };
  const tenant = path.join(root, "tenants", request.slug);
  if (!fs.existsSync(path.join(factory, "nieuw-os.mjs"))) throw new Error("factory_missing");
  run(process.execPath, [path.join(factory, "nieuw-os.mjs"), request.slug, `--doel=${tenant}`, "--doen"]);
  fs.writeFileSync(path.join(tenant, "api", "_klant.js"), buildCustomerModule(request, firebase));
  replacePublicPlaceholders(tenant, request, firebase);
  run(process.execPath, [path.join(factory, "nieuw-os.mjs"), request.slug, `--doel=${tenant}`, "--namen", "--doen"]);
  run("npm", ["ci", "--ignore-scripts"], { cwd: tenant });
  run("npm", ["test"], { cwd: tenant });
  const state = {
    request,
    tenant,
    project: `socialnow-os-${request.slug}`,
    domain: `${request.slug}.socialnow.nl`,
    siteUrl: `https://${request.slug}.socialnow.nl`,
    inviteToken: createOwnerInvite(request.requestId),
    inviteExpiresAt: inviteExpiry(),
    sessionSecret: crypto.randomBytes(48).toString("base64url"),
  };
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `slug=${request.slug}\n`, { mode: 0o600 });
  process.stdout.write(`Prepared and tested tenant ${request.slug}\n`);
} else if (command === "deploy") {
  const state = loadState();
  const cwd = state.tenant;
  vercel(["link", "--yes", "--team", required("VERCEL_TEAM_ID"), "--project", state.project], { cwd });
  env("HUB_SESSION_SECRET", state.sessionSecret, cwd);
  env("HUB_ALLOWED_EMAILS", state.request.ownerEmail, cwd);
  env("HUB_EIGENAARS", state.request.ownerEmail, cwd);
  env("HUB_GOEDKEURING", "0", cwd);
  env("HUB_MFA_INSCHRIJVEN", "0", cwd);
  env("HUB_MFA_VERPLICHT", "0", cwd);
  const listed = JSON.parse(vercel(["env", "ls", "production", "--json"], { cwd }));
  if (!(listed.envs || []).some(item => item.key === "BLOB_READ_WRITE_TOKEN")) {
    vercel(["blob", "create-store", `${state.request.slug}-os-data`, "--access", "private", "--region", "fra1", "--yes", "--environment", "production"], { cwd });
  }
  try { vercel(["domains", "add", state.domain, state.project], { cwd }); }
  catch (error) { if (!/already|exists|configured/i.test(error.message)) throw error; }
  const deployed = JSON.parse(vercel(["deploy", "--prod", "--yes", "--json"], { cwd }));
  if (!deployed.url) throw new Error("deployment_url_missing");
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(state.siteUrl, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) }); healthy = [200, 301, 302, 303, 307, 308].includes(response.status); }
    catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!healthy) throw new Error("production_domain_not_healthy");
  process.stdout.write(`Deployed and verified ${state.siteUrl}\n`);
} else if (command === "callback") {
  const state = loadState();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    timestamp,
    requestId: state.request.requestId,
    slug: state.request.slug,
    siteUrl: state.siteUrl,
    inviteToken: state.inviteToken,
    inviteExpiresAt: state.inviteExpiresAt,
  };
  const response = await fetch(required("HERMES_CALLBACK_URL"), {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      "X-Hermes-Timestamp": timestamp,
      "X-Hermes-Signature": `sha256=${callbackSignature(payload, required("HERMES_CALLBACK_SECRET"))}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`callback_failed_${response.status}`);
  process.stdout.write(`Owner invitation accepted for ${state.request.slug}\n`);
} else {
  throw new Error("usage: provision-request.mjs prepare|deploy|callback requests/<id>.json");
}

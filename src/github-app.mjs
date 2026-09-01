import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.github.com";
const API_VERSION = "2026-03-10";

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppJwt({ appId, privateKey, now = Date.now() }) {
  if (!/^\d+$/.test(String(appId || ""))) throw new Error("Ongeldig GitHub App-ID");
  let key;
  try { key = privateKey?.type === "private" ? privateKey : crypto.createPrivateKey(privateKey); }
  catch { throw new Error("Ongeldige GitHub App-sleutel"); }
  const timestamp = Math.floor(now / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: timestamp - 30,
    exp: timestamp + 540,
    iss: String(appId),
  })}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function parseRepository(value) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(value || ""));
  if (!match) throw new Error("Ongeldige GitHub-repository");
  return { owner: match[1], repo: match[2] };
}

export class GitHubAppClient {
  constructor({ appId, installationId, privateKey, repository, fetchImpl = fetch, now = () => Date.now() }) {
    if (!/^\d+$/.test(String(installationId || ""))) throw new Error("Ongeldig installatie-ID");
    this.appId = String(appId);
    this.installationId = String(installationId);
    this.privateKey = privateKey;
    this.repository = parseRepository(repository);
    this.fetch = fetchImpl;
    this.now = now;
    this.token = null;
    this.expiresAt = 0;
  }

  async installationToken() {
    if (this.token && this.expiresAt - this.now() > 5 * 60_000) return this.token;
    const jwt = createAppJwt({ appId: this.appId, privateKey: this.privateKey, now: this.now() });
    const response = await this.fetch(`${API}/app/installations/${this.installationId}/access_tokens`, {
      method: "POST",
      headers: this.headers(jwt),
    });
    if (!response.ok) throw new Error(`GitHub App-token geweigerd (${response.status})`);
    const result = await response.json();
    this.token = result.token;
    this.expiresAt = Date.parse(result.expires_at);
    return this.token;
  }

  headers(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "socialnow-hermes-queue",
    };
  }

  contentUrl(filename) {
    const { owner, repo } = this.repository;
    return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/requests/${encodeURIComponent(filename)}`;
  }

  async exists(filename, token) {
    const response = await this.fetch(this.contentUrl(filename), { headers: this.headers(token) });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub queuecontrole mislukt (${response.status})`);
    return true;
  }

  async deliver(filename, encryptedEnvelope) {
    const token = await this.installationToken();
    if (await this.exists(filename, token)) return "already_delivered";
    const response = await this.fetch(this.contentUrl(filename), {
      method: "PUT",
      headers: { ...this.headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Queue tenant ${filename.replace(/\.json$/, "")}`,
        content: Buffer.from(encryptedEnvelope).toString("base64"),
        branch: "main",
      }),
    });
    if (response.ok) return "delivered";
    if (response.status === 409 || response.status === 422) {
      if (await this.exists(filename, token)) return "already_delivered";
    }
    throw new Error(`GitHub queuedelivery mislukt (${response.status})`);
  }
}

export async function runQueuePusher({ client, queueRoot = "/queue", pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const outbox = path.join(queueRoot, "outbox");
  const delivered = path.join(queueRoot, "delivered");
  await fs.mkdir(outbox, { recursive: true });
  await fs.mkdir(delivered, { recursive: true });

  while (true) {
    const filenames = (await fs.readdir(outbox)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort();
    for (const filename of filenames) {
      try {
        const pending = path.join(outbox, filename);
        const result = await client.deliver(filename, await fs.readFile(pending));
        await fs.rename(pending, path.join(delivered, filename));
        process.stdout.write(`${JSON.stringify({ event: result, request: filename })}\n`);
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ event: "delivery_retry", request: filename, reason: error.message })}\n`);
      }
    }
    await pause(2_000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const privateKey = Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_B64 || "", "base64").toString("utf8");
  const client = new GitHubAppClient({
    appId: process.env.GITHUB_APP_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    privateKey,
    repository: process.env.QUEUE_GITHUB_REPOSITORY,
  });
  await runQueuePusher({ client });
}

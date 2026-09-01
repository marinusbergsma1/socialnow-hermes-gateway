import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createAppJwt, GitHubAppClient, parseRepository } from "../src/github-app.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

test("GitHub App JWT is kortlevend en cryptografisch geldig", () => {
  const now = Date.UTC(2026, 8, 1, 12);
  const jwt = createAppJwt({ appId: "12345", privateKey, now });
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "12345");
  assert.equal(claims.exp - claims.iat, 570);
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
});

test("GitHub App blijft beperkt tot één expliciete repository", () => {
  assert.deepEqual(parseRepository("marinusbergsma1/socialnow-hermes-provisioning"), {
    owner: "marinusbergsma1",
    repo: "socialnow-hermes-provisioning",
  });
  assert.throws(() => parseRepository("https://github.com/owner/repo"));
});

test("versleutelde queue-inhoud wordt idempotent via de Contents API geplaatst", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/access_tokens")) {
      return new Response(JSON.stringify({ token: "installation-token", expires_at: "2026-09-01T13:00:00Z" }), { status: 201 });
    }
    if (!options.method) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ content: {} }), { status: 201 });
  };
  const client = new GitHubAppClient({
    appId: "12345",
    installationId: "67890",
    privateKey,
    repository: "marinusbergsma1/socialnow-hermes-provisioning",
    fetchImpl,
    now: () => Date.UTC(2026, 8, 1, 12),
  });
  assert.equal(await client.deliver("123e4567-e89b-12d3-a456-426614174000.json", Buffer.from('{"ciphertext":"x"}')), "delivered");
  const put = calls.find(call => call.options.method === "PUT");
  assert.equal(JSON.parse(put.options.body).content, Buffer.from('{"ciphertext":"x"}').toString("base64"));
  assert.match(put.options.headers.Authorization, /^Bearer installation-token$/);
});

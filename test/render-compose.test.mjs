import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("Hostinger compose bevat gescheiden containers zonder geheime waarden", () => {
  const script = path.resolve(import.meta.dirname, "../deploy/render-compose.mjs");
  const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  assert.match(output, /provisioner:/);
  assert.match(output, /queue-pusher:/);
  assert.match(output, /caddy:/);
  assert.doesNotMatch(output, /edge-proxy:/);
  assert.match(output, /GITHUB_APP_PRIVATE_KEY_B64: \$\{GITHUB_APP_PRIVATE_KEY_B64\}/);
  assert.doesNotMatch(output, /GODEBUG|\bdns:|resolv\.conf/);
  assert.match(output, /reverse_proxy provisioner:3000/);
  assert.doesNotMatch(output, /QUEUE_SSH_PRIVATE_KEY_B64/);
  assert.doesNotMatch(output, /BEGIN OPENSSH PRIVATE KEY/);
});

test("compact Hostinger-manifest blijft onder de API-limiet en pint bronhashes", () => {
  const script = path.resolve(import.meta.dirname, "../deploy/render-compact-compose.mjs");
  const output = execFileSync(process.execPath, [script, "a".repeat(40)], { encoding: "utf8" });
  assert.ok(Buffer.byteLength(output) <= 8192);
  assert.match(output, /sha256sum -c/);
  assert.match(output, /QUEUE_ENCRYPTION_KEY: \$\{QUEUE_ENCRYPTION_KEY\}/);
  assert.match(output, /GITHUB_APP_INSTALLATION_ID: \$\{GITHUB_APP_INSTALLATION_ID\}/);
  assert.doesNotMatch(output, /QUEUE_SSH_PRIVATE_KEY_B64/);
  assert.match(output, /127\.0\.0\.1:39101:3000/);
  assert.doesNotMatch(output, /network_mode: host/);
  assert.doesNotMatch(output, /GODEBUG|\bdns:|resolv\.conf/);
  assert.match(output, /ports: \["80:80", "443:443"\]/);
  assert.match(output, /base64 -d > \/tmp\/Caddyfile/);
  assert.doesNotMatch(output, /raw\.githubusercontent\.com.*deploy\/Caddyfile/);
  assert.doesNotMatch(output, /BEGIN OPENSSH PRIVATE KEY/);
});

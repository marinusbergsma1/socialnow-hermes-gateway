import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("Hostinger compose bevat drie gescheiden containers zonder geheime waarden", () => {
  const script = path.resolve(import.meta.dirname, "../deploy/render-compose.mjs");
  const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  assert.match(output, /provisioner:/);
  assert.match(output, /queue-pusher:/);
  assert.match(output, /caddy:/);
  assert.match(output, /QUEUE_SSH_PRIVATE_KEY_B64: \$\{QUEUE_SSH_PRIVATE_KEY_B64\}/);
  assert.doesNotMatch(output, /BEGIN OPENSSH PRIVATE KEY/);
});

test("compact Hostinger-manifest blijft onder de API-limiet en pint bronhashes", () => {
  const script = path.resolve(import.meta.dirname, "../deploy/render-compact-compose.mjs");
  const output = execFileSync(process.execPath, [script, "a".repeat(40)], { encoding: "utf8" });
  assert.ok(Buffer.byteLength(output) <= 8192);
  assert.match(output, /sha256sum -c/);
  assert.match(output, /QUEUE_ENCRYPTION_KEY: \$\{QUEUE_ENCRYPTION_KEY\}/);
  assert.match(output, /127\.0\.0\.1:39101:3000/);
  assert.match(output, /network_mode: host/);
  assert.doesNotMatch(output, /BEGIN OPENSSH PRIVATE KEY/);
});

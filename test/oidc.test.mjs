import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyVercelOidc } from "../src/oidc.mjs";

const config = {
  issuer: "https://oidc.vercel.com/socialnow-team",
  audience: "https://hermes.socialnow.nl",
  subject: "owner:socialnow-team:project:os-os:environment:production",
};

function token(overrides = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "test" };
  const payload = {
    iss: config.issuer, aud: config.audience, sub: config.subject,
    iat: now, nbf: now, exp: now + 300, jti: "unique",
    project_id: "prj_test", owner_id: "team_test", environment: "production",
    ...overrides,
  };
  const encoded = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encoded(header)}.${encoded(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  return { value: `${input}.${signature}`, keys: [publicKey.export({ format: "jwk" })].map(key => ({ ...key, kid: "test", alg: "RS256" })) };
}

test("accepteert alleen een geldig, kortlevend token voor de exacte scope", async () => {
  const signed = token();
  const payload = await verifyVercelOidc(signed.value, config, async () => signed.keys);
  assert.equal(payload.project_id, "prj_test");
});

test("weigert een andere audience en te lange tokenlevensduur", async () => {
  const wrongAudience = token({ aud: "https://attacker.invalid" });
  await assert.rejects(() => verifyVercelOidc(wrongAudience.value, config, async () => wrongAudience.keys), /wrong_oidc_scope/);
  const now = Math.floor(Date.now() / 1000);
  const tooLong = token({ iat: now, nbf: now, exp: now + 13 * 60 * 60 + 6 });
  await assert.rejects(() => verifyVercelOidc(tooLong.value, config, async () => tooLong.keys), /invalid_jwt_lifetime/);
});

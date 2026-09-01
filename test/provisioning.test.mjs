import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCustomerModule, callbackSignature, createOwnerInvite, replacePublicPlaceholders } from "../src/provisioning.mjs";

const request = { requestId: "am_abc123_test", slug: "voorbeeld", company: "Voorbeeld BV", ownerEmail: "eigenaar@voorbeeld.nl", ownerName: "Eva Eigenaar", sector: "dienstverlening" };
const firebase = { projectId: "socialnow-auth", apiKey: "public-web-key" };

test("eigenaarsuitnodiging is onvoorspelbaar en aan het dossier gebonden", () => {
  const token = createOwnerInvite(request.requestId, Buffer.alloc(32, 7));
  assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token.split(".")[1], "base64url").toString(), request.requestId);
});
test("klantmodule bevat alleen publieke, afgebakende identiteit", () => {
  const output = buildCustomerModule(request, firebase);
  assert.match(output, /KLANT_ID = "voorbeeld"/);
  assert.match(output, /FB_PROJECT = "socialnow-auth"/);
  assert.doesNotMatch(output, /INVULLEN|PRIVATE KEY|ownerInvite/i);
});

test("publieke plaatshouders worden in alle tekstbestanden ingevuld", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-fill-"));
  fs.writeFileSync(path.join(directory, "login.html"), "INVULLEN-firebase-project INVULLEN Klantnaam https://INVULLEN.socialnow.nl");
  assert.equal(replacePublicPlaceholders(directory, request, firebase), 1);
  assert.equal(fs.readFileSync(path.join(directory, "login.html"), "utf8"), "socialnow-auth Voorbeeld BV https://voorbeeld.socialnow.nl");
});

test("callbackhandtekening verandert bij ieder beveiligd veld", () => {
  const payload = { timestamp: "1788276000", requestId: request.requestId, slug: request.slug, siteUrl: "https://voorbeeld.socialnow.nl", inviteToken: "v1.a.b", inviteExpiresAt: "2026-09-04T12:00:00.000Z" };
  const secret = crypto.randomBytes(32).toString("base64url");
  const signature = callbackSignature(payload, secret);
  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.notEqual(signature, callbackSignature({ ...payload, slug: "ander" }, secret));
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptRequest, encryptRequest, validateProvisionRequest } from "../src/core.mjs";

const request = {
  requestId: "am_mf123abc_abcd2345",
  slug: "voorbeeld-bedrijf",
  company: "Voorbeeld Bedrijf B.V.",
  ownerEmail: "Eigenaar@Voorbeeld.nl",
  ownerName: "Ellen Eigenaar",
  country: "nl",
  language: "nl",
  sector: "dienstverlening",
};

test("normaliseert en accepteert een afgebakende aanvraag", () => {
  const result = validateProvisionRequest(request, request.requestId);
  assert.equal(result.ownerEmail, "eigenaar@voorbeeld.nl");
  assert.equal(result.country, "NL");
});

test("weigert extra velden en gereserveerde slugs", () => {
  assert.throws(() => validateProvisionRequest({ ...request, mobile: "+316123" }, request.requestId), /unknown_field/);
  assert.throws(() => validateProvisionRequest({ ...request, slug: "login" }, request.requestId), /invalid_slug/);
});

test("idempotency key moet exact het dossier zijn", () => {
  assert.throws(() => validateProvisionRequest(request, "ander"), /idempotency_mismatch/);
});

test("GitHub ontvangt alleen een versleutelde envelop", () => {
  const key = crypto.randomBytes(32);
  const normal = validateProvisionRequest(request, request.requestId);
  const envelope = encryptRequest(normal, key);
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /eigenaar@voorbeeld\.nl/i);
  assert.deepEqual(decryptRequest(envelope, key), normal);
});


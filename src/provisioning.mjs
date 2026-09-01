import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function js(value) {
  return JSON.stringify(String(value ?? ""));
}
export function createOwnerInvite(requestId, random = crypto.randomBytes(32)) {
  if (!/^am_[a-z0-9_]{6,70}$/.test(String(requestId || ""))) throw new Error("invalid_request_id");
  return `v1.${Buffer.from(requestId).toString("base64url")}.${Buffer.from(random).toString("base64url")}`;
}

export function inviteExpiry(now = Date.now()) {
  return new Date(now + 72 * 60 * 60 * 1000).toISOString();
}

export function buildCustomerModule(request, firebase) {
  const osUrl = `https://${request.slug}.socialnow.nl`;
  const emailDomain = request.ownerEmail.split("@")[1];
  return `// Automatisch en controleerbaar gegenereerd door SocialNow Hermes.
// Geen geheimen in dit bestand: de Firebase-webconfig is publiek; privésleutels staan
// uitsluitend in de afgeschermde omgevingsvariabelen van het OS OS.

export const FB_PROJECT = ${js(firebase.projectId)};
export const FB_API_KEY = ${js(firebase.apiKey)};
export const VASTE_DOMEINEN = [${js(emailDomain)}, "socialnow.nl"];

export const KLANT_ID = ${js(request.slug)};
export const KLANT_NAAM = ${js(request.company)};
export const OS_URL = ${js(osUrl)};
export const SITE_URL = ${js(osUrl)};
export const SESSIE_AUDIENCE = KLANT_ID + "-os";

export const ODOO = { url: "https://niet-gekoppeld.invalid", db: ${js(request.slug)}, uid: 0 };

export const TENANT = { id: KLANT_ID, name: KLANT_NAAM, ownerName: ${js(request.ownerName)}, website: SITE_URL };
export const TENANT_PAD = "platform/v1/tenants/" + KLANT_ID + ".json";
export const EIGEN_ADRESSEN = [OS_URL];
export const WAT_DOET_DE_KLANT = ${js(`${request.company} gebruikt SocialNow OS voor de eigen bedrijfsvoering.`)};
export const SECTOR = ${js(request.sector)};
`;
}

export function replacePublicPlaceholders(root, request, firebase) {
  const replacements = [
    ["INVULLEN-firebase-project", firebase.projectId],
    ["INVULLEN-firebase-web-api-key", firebase.apiKey],
    ["INVULLEN Klantnaam", request.company],
    ["INVULLEN Naam eigenaar", request.ownerName],
    ["https://INVULLEN.socialnow.nl", `https://${request.slug}.socialnow.nl`],
    ["https://INVULLEN-klantdomein.nl", `https://${request.slug}.socialnow.nl`],
    ["INVULLEN-klantdomein.nl", `${request.slug}.socialnow.nl`],
  ];
  let changed = 0;
  const walk = directory => {
    for (const name of fs.readdirSync(directory)) {
      if ([".git", ".vercel", "node_modules"].includes(name) || name.startsWith("._")) continue;
      const target = path.join(directory, name);
      const stat = fs.statSync(target);
      if (stat.isDirectory()) { walk(target); continue; }
      if (!/\.(?:html|js|mjs|json|css|md)$/.test(name)) continue;
      const original = fs.readFileSync(target, "utf8");
      let updated = original;
      for (const [from, to] of replacements) updated = updated.split(from).join(to);
      if (updated !== original) { fs.writeFileSync(target, updated); changed++; }
    }
  };
  walk(root);
  return changed;
}

export function callbackMessage({ timestamp, requestId, slug, siteUrl, inviteToken, inviteExpiresAt }) {
  return ["v1", timestamp, requestId, slug, siteUrl, inviteToken, inviteExpiresAt].join("\n");
}

export function callbackSignature(payload, secret) {
  if (String(secret || "").length < 32) throw new Error("invalid_callback_secret");
  return crypto.createHmac("sha256", secret).update(callbackMessage(payload)).digest("hex");
}

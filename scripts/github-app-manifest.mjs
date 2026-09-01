import crypto from "node:crypto";
import http from "node:http";
import { spawnSync } from "node:child_process";

const host = "127.0.0.1";
const port = 39831;
const owner = "marinusbergsma1";
const service = "socialnow-hermes-github-app";
const state = crypto.randomBytes(32).toString("hex");
const ghToken = process.env.GH_TOKEN;

if (!ghToken) throw new Error("GH_TOKEN ontbreekt");

let appConfig;

const manifest = {
  name: "SocialNow Hermes Onboarding",
  url: "https://os.socialnow.nl/aanmelden/",
  description: "Beperkte GitHub-koppeling voor de automatische SocialNow-onboarding.",
  redirect_url: `http://${host}:${port}/callback`,
  setup_url: `http://${host}:${port}/installed`,
  public: false,
  request_oauth_on_install: false,
  setup_on_update: true,
  hook_attributes: {
    url: "https://hermes.socialnow.nl/v1/github/events",
    active: false,
  },
  default_permissions: {
    actions: "read",
    contents: "write",
  },
  default_events: [],
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(title, body) {
  return `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui;max-width:680px;margin:64px auto;padding:0 24px;line-height:1.5;color:#111827}button,a.cta{display:inline-block;border:0;border-radius:10px;background:#111827;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700;cursor:pointer}.note{color:#4b5563}code{background:#f3f4f6;padding:2px 5px;border-radius:5px}</style><h1>${escapeHtml(title)}</h1>${body}</html>`;
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(body);
}

function store(account, value) {
  const result = spawnSync("security", ["add-generic-password", "-U", "-a", account, "-s", service, "-w", String(value)], {
    stdio: "ignore",
  });
  if (result.status !== 0) throw new Error(`Opslaan in Sleutelhanger mislukt: ${account}`);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function appJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: config.id }))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), config.pem).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function exchange(code) {
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${ghToken}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "socialnow-hermes-manifest",
    },
  });
  if (!response.ok) throw new Error(`GitHub-conversie mislukt (${response.status})`);
  return response.json();
}

async function findInstallation(config) {
  const response = await fetch("https://api.github.com/app/installations", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt(config)}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "socialnow-hermes-manifest",
    },
  });
  if (!response.ok) throw new Error(`Installatiecontrole mislukt (${response.status})`);
  const installations = await response.json();
  return installations.find(item => item.account?.login === owner);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (url.pathname === "/") {
      const action = `https://github.com/settings/apps/new?state=${state}`;
      send(res, 200, page("GitHub App koppelen", `<p>Maak de afgeschermde GitHub App aan met alleen <code>Contents: read/write</code> en <code>Actions: read</code>.</p><form action="${action}" method="post"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button type="submit">GitHub App aanmaken</button></form><p class="note">GitHub toont de rechten nog één keer voordat de App wordt gemaakt.</p>`));
      return;
    }

    if (url.pathname === "/callback") {
      if (url.searchParams.get("state") !== state) throw new Error("Ongeldige statuscode");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("GitHub-code ontbreekt");
      appConfig = await exchange(code);
      store("app-id", appConfig.id);
      store("client-id", appConfig.client_id);
      store("private-key-b64", Buffer.from(appConfig.pem).toString("base64"));
      store("webhook-secret", appConfig.webhook_secret);
      store("slug", appConfig.slug);
      const installUrl = `https://github.com/apps/${encodeURIComponent(appConfig.slug)}/installations/new`;
      send(res, 200, page("App veilig aangemaakt", `<p>De sleutel staat in macOS Sleutelhanger en is niet in Git of een bestand opgeslagen.</p><p><a class="cta" href="${installUrl}">Installeren op geselecteerde repositories</a></p><p class="note">Selecteer alleen <code>socialnow-hermes-provisioning</code> en <code>socialnow-os-fabriek</code>.</p>`));
      return;
    }

    if (url.pathname === "/installed") {
      if (!appConfig) throw new Error("Maak de App eerst via deze lokale sessie aan");
      const installation = await findInstallation(appConfig);
      if (!installation) throw new Error("De installatie is nog niet zichtbaar");
      store("installation-id", installation.id);
      send(res, 200, page("GitHub App gekoppeld", "<p>De installatie is gecontroleerd en veilig opgeslagen. Je kunt dit tabblad sluiten; Codex gaat automatisch verder.</p>"));
      return;
    }

    send(res, 404, page("Niet gevonden", "<p>Deze lokale pagina bestaat niet.</p>"));
  } catch (error) {
    send(res, 500, page("Koppeling niet voltooid", `<p>${escapeHtml(error.message)}</p><p><a href="/">Opnieuw proberen</a></p>`));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`GitHub App-koppeling klaar op http://${host}:${port}/\n`);
});

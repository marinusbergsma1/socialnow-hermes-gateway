import fs from "node:fs";
import { GitHubAppClient } from "../src/github-app.mjs";

const client = new GitHubAppClient({
  appId: process.env.HERMES_GITHUB_APP_ID,
  installationId: process.env.HERMES_GITHUB_APP_INSTALLATION_ID,
  privateKey: Buffer.from(process.env.HERMES_GITHUB_APP_PRIVATE_KEY_B64 || "", "base64").toString("utf8"),
  repository: "marinusbergsma1/socialnow-os-fabriek",
});
const token = await client.installationToken();
process.stdout.write(`::add-mask::${token}\n`);
fs.appendFileSync(process.env.GITHUB_OUTPUT, `token=${token}\n`, { mode: 0o600 });

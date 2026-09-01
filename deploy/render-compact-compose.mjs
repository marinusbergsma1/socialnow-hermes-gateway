import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || "")) throw new Error("Geef de publieke Git-commit mee");

const sources = ["server.mjs", "core.mjs", "oidc.mjs", "file-queue.mjs", "github-app.mjs"];
const digest = relative => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
const base = `https://raw.githubusercontent.com/marinusbergsma1/socialnow-hermes-gateway/${revision}`;
const downloads = sources.map(name => `wget -qO ${name} ${base}/src/${name}`).join("\n        ");
const checks = sources.map(name => `${digest(`src/${name}`)}  ${name}`).join("\\n");
const caddyDigest = digest("deploy/Caddyfile");
const caddyConfig = fs.readFileSync(path.join(root, "deploy/Caddyfile")).toString("base64");

const compose = `services:
  queue-init:
    image: alpine:3.22
    restart: "no"
    command: ["/bin/sh", "-c", "mkdir -p /queue/outbox /queue/replay /queue/delivered && chown -R 1000:1000 /queue/outbox /queue/replay /queue/delivered"]
    volumes: ["hermes_queue:/queue"]
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    cap_add: ["CHOWN"]

  provisioner:
    image: node:22-alpine
    restart: unless-stopped
    depends_on:
      queue-init: { condition: service_completed_successfully }
    user: node
    command:
      - /bin/sh
      - -ec
      - |
        mkdir -p /tmp/app
        cd /tmp/app
        ${downloads}
        printf '${checks}\\n' | sha256sum -c -
        exec node server.mjs
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATA_DIR: /data
      QUEUE_MODE: file
      VERCEL_OIDC_ISSUER: \${VERCEL_OIDC_ISSUER}
      VERCEL_OIDC_AUDIENCE: \${VERCEL_OIDC_AUDIENCE}
      VERCEL_OIDC_SUBJECT: \${VERCEL_OIDC_SUBJECT}
      VERCEL_PROJECT_ID: \${VERCEL_PROJECT_ID}
      VERCEL_OWNER_ID: \${VERCEL_OWNER_ID}
      QUEUE_ENCRYPTION_KEY: \${QUEUE_ENCRYPTION_KEY}
    ports: ["127.0.0.1:39101:3000"]
    volumes: ["hermes_queue:/data"]
    read_only: true
    tmpfs: ["/tmp:size=32m,noexec,nosuid"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    pids_limit: 80
    mem_limit: 192m
    cpus: 0.50
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 15s

  queue-pusher:
    image: node:22-alpine
    restart: unless-stopped
    depends_on:
      queue-init: { condition: service_completed_successfully }
    user: node
    command:
      - /bin/sh
      - -ec
      - |
        mkdir -p /tmp/app
        cd /tmp/app
        wget -qO github-app.mjs ${base}/src/github-app.mjs
        echo '${digest("src/github-app.mjs")}  github-app.mjs' | sha256sum -c -
        exec node github-app.mjs
    environment:
      QUEUE_GITHUB_REPOSITORY: \${QUEUE_GITHUB_REPOSITORY}
      GITHUB_APP_ID: \${GITHUB_APP_ID}
      GITHUB_APP_INSTALLATION_ID: \${GITHUB_APP_INSTALLATION_ID}
      GITHUB_APP_PRIVATE_KEY_B64: \${GITHUB_APP_PRIVATE_KEY_B64}
    volumes: ["hermes_queue:/queue"]
    read_only: true
    tmpfs: ["/tmp:size=16m,noexec,nosuid"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    pids_limit: 80
    mem_limit: 128m
    cpus: 0.25

  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    depends_on:
      provisioner: { condition: service_healthy }
    command:
      - /bin/sh
      - -ec
      - |
        printf '%s' '${caddyConfig}' | base64 -d > /tmp/Caddyfile
        echo '${caddyDigest}  /tmp/Caddyfile' | sha256sum -c -
        exec caddy run --config /tmp/Caddyfile --adapter caddyfile
    environment:
      GODEBUG: netdns=cgo
    ports: ["80:80", "443:443"]
    volumes: ["caddy_data:/data", "caddy_config:/config"]
    read_only: true
    tmpfs: ["/tmp:size=4m,noexec,nosuid"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    cap_add: ["NET_BIND_SERVICE"]
    pids_limit: 100
    mem_limit: 256m
    cpus: 0.50

volumes:
  hermes_queue:
  caddy_data:
  caddy_config:
`;

if (Buffer.byteLength(compose) > 8192) throw new Error(`Compact manifest te groot: ${Buffer.byteLength(compose)}`);
process.stdout.write(compose);

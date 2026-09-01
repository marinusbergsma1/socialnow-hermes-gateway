import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || "")) throw new Error("Geef de publieke Git-commit mee");

const sources = ["server.mjs", "core.mjs", "oidc.mjs", "file-queue.mjs", "queue.mjs"];
const digest = relative => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
const base = `https://raw.githubusercontent.com/marinusbergsma1/socialnow-hermes-gateway/${revision}`;
const downloads = sources.map(name => `wget -qO ${name} ${base}/src/${name}`).join("\n        ");
const checks = sources.map(name => `${digest(`src/${name}`)}  ${name}`).join("\\n");
const queueDigest = digest("deploy/queue-pusher.sh");

const compose = `services:
  queue-init:
    image: alpine:3.22
    restart: "no"
    command: ["/bin/sh", "-c", "mkdir -p /queue/outbox /queue/replay /queue/delivered /queue/repo && chown -R 1000:1000 /queue/outbox /queue/replay && chmod 700 /queue/outbox /queue/replay"]
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
    image: alpine/git:latest
    restart: unless-stopped
    depends_on:
      queue-init: { condition: service_completed_successfully }
    entrypoint:
      - /bin/sh
      - -ec
      - |
        wget -qO /tmp/queue-pusher.sh ${base}/deploy/queue-pusher.sh
        echo '${queueDigest}  /tmp/queue-pusher.sh' | sha256sum -c -
        exec /bin/sh /tmp/queue-pusher.sh
    environment:
      QUEUE_GIT_REPOSITORY: \${QUEUE_GIT_REPOSITORY}
      QUEUE_SSH_PRIVATE_KEY_B64: \${QUEUE_SSH_PRIVATE_KEY_B64}
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
    command: ["caddy", "reverse-proxy", "--from", "hermes.socialnow.nl", "--to", "provisioner:3000"]
    ports: ["80:80", "443:443"]
    volumes: ["caddy_data:/data", "caddy_config:/config"]
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

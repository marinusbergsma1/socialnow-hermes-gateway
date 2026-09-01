import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = {
  caddyfile: "deploy/Caddyfile",
  github_app: "src/github-app.mjs",
  server: "src/server.mjs",
  core: "src/core.mjs",
  oidc: "src/oidc.mjs",
  file_queue: "src/file-queue.mjs",
};

function content(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8").replace(/\s+$/, "");
}

function block(value, spaces = 4) {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map(line => `${prefix}${line}`).join("\n");
}

const compose = `services:
  queue-init:
    image: alpine:3.22
    restart: "no"
    command: ["/bin/sh", "-c", "mkdir -p /queue/outbox /queue/replay /queue/delivered && chown -R 1000:1000 /queue/outbox /queue/replay /queue/delivered"]
    volumes:
      - hermes_queue:/queue
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN

  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    depends_on:
      provisioner:
        condition: service_healthy
    environment:
      GODEBUG: netdns=cgo
    ports:
      - "80:80"
      - "443:443"
    configs:
      - source: caddyfile
        target: /etc/caddy/Caddyfile
    volumes:
      - caddy_data:/data
      - caddy_config:/config
    read_only: true
    tmpfs:
      - /tmp:size=4m,noexec,nosuid
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    pids_limit: 100
    mem_limit: 256m
    cpus: 0.50

  provisioner:
    image: node:22-alpine
    restart: unless-stopped
    depends_on:
      queue-init:
        condition: service_completed_successfully
    user: node
    command: ["node", "/app/server.mjs"]
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
    ports:
      - "127.0.0.1:39101:3000"
    configs:
      - source: server
        target: /app/server.mjs
      - source: core
        target: /app/core.mjs
      - source: oidc
        target: /app/oidc.mjs
      - source: file_queue
        target: /app/file-queue.mjs
    volumes:
      - hermes_queue:/data
    read_only: true
    tmpfs:
      - /tmp:size=32m,noexec,nosuid
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 80
    mem_limit: 192m
    cpus: 0.50
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s

  queue-pusher:
    image: node:22-alpine
    restart: unless-stopped
    depends_on:
      queue-init:
        condition: service_completed_successfully
    user: node
    command: ["node", "/app/github-app.mjs"]
    environment:
      QUEUE_GITHUB_REPOSITORY: \${QUEUE_GITHUB_REPOSITORY}
      GITHUB_APP_ID: \${GITHUB_APP_ID}
      GITHUB_APP_INSTALLATION_ID: \${GITHUB_APP_INSTALLATION_ID}
      GITHUB_APP_PRIVATE_KEY_B64: \${GITHUB_APP_PRIVATE_KEY_B64}
    configs:
      - source: github_app
        target: /app/github-app.mjs
    volumes:
      - hermes_queue:/queue
    read_only: true
    tmpfs:
      - /tmp:size=16m,noexec,nosuid
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 80
    mem_limit: 128m
    cpus: 0.25

volumes:
  caddy_data:
  caddy_config:
  hermes_queue:

configs:
${Object.entries(files).map(([name, relative]) => `  ${name}:\n    content: |\n${block(content(relative), 6)}`).join("\n")}
`;

process.stdout.write(compose);

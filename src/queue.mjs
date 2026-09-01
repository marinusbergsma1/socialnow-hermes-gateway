import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const GITHUB_HOST_KEY = "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command}_failed_${code}:${stderr.slice(-500)}`)));
  });
}

export class GitQueue {
  constructor({ dataDir, repository, privateKeyBase64 }) {
    if (!/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository || "")) throw new Error("invalid_queue_repository");
    if (!privateKeyBase64) throw new Error("missing_queue_key");
    this.root = path.join(dataDir, "queue");
    this.sshDir = path.join(dataDir, ".ssh");
    this.keyPath = path.join(this.sshDir, "queue_ed25519");
    this.knownHosts = path.join(this.sshDir, "known_hosts");
    this.repository = repository;
    this.key = Buffer.from(privateKeyBase64, "base64").toString("utf8");
    this.lock = Promise.resolve();
  }

  async setup() {
    await fs.mkdir(this.sshDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.keyPath, this.key, { mode: 0o600 });
    await fs.writeFile(this.knownHosts, GITHUB_HOST_KEY, { mode: 0o600 });
    this.gitEnv = {
      ...process.env,
      GIT_SSH_COMMAND: `ssh -i ${this.keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${this.knownHosts}`,
    };
    try { await fs.access(path.join(this.root, ".git")); }
    catch {
      await fs.mkdir(path.dirname(this.root), { recursive: true });
      await run("git", ["clone", "--depth", "1", "--branch", "main", this.repository, this.root], { env: this.gitEnv });
    }
    await run("git", ["config", "user.name", "Hermes Provisioner"], { cwd: this.root, env: this.gitEnv });
    await run("git", ["config", "user.email", "hermes-provisioner@users.noreply.github.com"], { cwd: this.root, env: this.gitEnv });
  }

  enqueue(envelope) {
    const task = this.lock.then(() => this.#enqueue(envelope));
    this.lock = task.catch(() => {});
    return task;
  }

  async #enqueue(envelope) {
    await this.setup();
    await run("git", ["fetch", "--depth", "1", "origin", "main"], { cwd: this.root, env: this.gitEnv });
    await run("git", ["reset", "--hard", "origin/main"], { cwd: this.root, env: this.gitEnv });
    const relative = `requests/${envelope.requestId}.json`;
    const target = path.join(this.root, relative);
    try {
      const existing = JSON.parse(await fs.readFile(target, "utf8"));
      if (existing.requestId === envelope.requestId && existing.slug === envelope.slug) return { existing: true };
      throw new Error("request_conflict");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await run("git", ["add", "--", relative], { cwd: this.root, env: this.gitEnv });
    await run("git", ["commit", "-m", `Queue tenant ${envelope.requestId}`], { cwd: this.root, env: this.gitEnv });
    await run("git", ["push", "origin", "HEAD:main"], { cwd: this.root, env: this.gitEnv });
    return { existing: false };
  }
}


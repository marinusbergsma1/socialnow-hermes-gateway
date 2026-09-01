import fs from "node:fs/promises";
import path from "node:path";

export class FileQueue {
  constructor({ dataDir }) {
    this.outbox = path.join(dataDir, "outbox");
    this.lock = Promise.resolve();
  }

  enqueue(envelope) {
    const task = this.lock.then(() => this.#enqueue(envelope));
    this.lock = task.catch(() => {});
    return task;
  }

  async #enqueue(envelope) {
    await fs.mkdir(this.outbox, { recursive: true });
    const target = path.join(this.outbox, `${envelope.requestId}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(target, "utf8"));
      if (existing.requestId === envelope.requestId && existing.slug === envelope.slug) return { existing: true };
      throw new Error("request_conflict");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { existing: false };
  }
}


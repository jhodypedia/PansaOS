import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { safePath } from "./security.js";
import type { Sandbox } from "./sandbox.js";

export function applyEdits(raw: string, edits: { old: string; replacement: string }[]) {
  let next = raw;
  for (const edit of edits) {
    if (!edit.old || next.split(edit.old).length !== 2) throw new Error("Text must match exactly once; all edits cancelled");
    next = next.replace(edit.old, edit.replacement);
  }
  return next;
}
export function previewDiff(file: string, before: string, after: string) {
  if (before === after) return "No changes";
  return `--- a/${file}\n+++ b/${file}\n@@ -1,${before.split("\n").length} +1,${after.split("\n").length} @@\n${before.split("\n").map(l => `-${l}`).join("\n")}\n${after.split("\n").map(l => `+${l}`).join("\n")}`;
}
async function files(root: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, base), { withFileTypes: true })) {
    if ([".git", "node_modules", ".next", ".home", ".local"].includes(entry.name)) continue;
    const rel = path.join(base, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...await files(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}
export class Checkpoints {
  constructor(public sandbox: Sandbox) {}
  async list(session: string) {
    const root = path.join(await this.sandbox.home(session), "checkpoints");
    await fs.mkdir(root, { recursive: true });
    const rows: { id: string; name: string; time: string; files: string[]; hashes: Record<string, string> }[] = [];
    for (const id of await fs.readdir(root)) {
      try { rows.push(JSON.parse(await fs.readFile(path.join(root, id, "manifest.json"), "utf8"))); } catch {}
    }
    return rows.sort((a, b) => b.time.localeCompare(a.time));
  }
  async create(session: string, name: string) {
    const root = await this.sandbox.root(session), id = randomUUID();
    const dest = path.join(await this.sandbox.home(session), "checkpoints", id);
    await fs.mkdir(path.join(dest, "files"), { recursive: true });
    const manifest = { id, name, time: new Date().toISOString(), files: await files(root), hashes: {} as Record<string, string> };
    for (const file of manifest.files) {
      const src = await safePath(root, file), target = path.join(dest, "files", file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(src, target);
      manifest.hashes[file] = createHash("sha256").update(await fs.readFile(src)).digest("hex");
    }
    await fs.writeFile(path.join(dest, "manifest.json"), JSON.stringify(manifest));
    return manifest;
  }
  async changes(session: string, id: string) {
    const manifest = (await this.list(session)).find(m => m.id === id);
    if (!manifest) throw new Error("Checkpoint not found");
    const root = await this.sandbox.root(session), current = await files(root);
    const changed: string[] = [];
    for (const file of new Set([...current, ...manifest.files])) {
      const raw = await fs.readFile(await safePath(root, file)).catch(() => Buffer.alloc(0));
      if (!current.includes(file) || !manifest.files.includes(file) || createHash("sha256").update(raw).digest("hex") !== manifest.hashes[file]) changed.push(file);
    }
    return { manifest, changed, current };
  }
  async restore(session: string, id: string) {
    const { manifest, changed, current } = await this.changes(session, id);
    const root = await this.sandbox.root(session), source = path.join(await this.sandbox.home(session), "checkpoints", id, "files");
    for (const file of changed) {
      const dest = await safePath(root, file);
      if (!manifest.files.includes(file)) { if (current.includes(file)) await fs.rm(dest); }
      else { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(path.join(source, file), dest); if (process.env.EXEC_MODE === "docker" && process.getuid?.() === 0) await fs.chown(dest, 1000, 1000); }
    }
    return { restored: changed, checkpoint: manifest.name };
  }
}

import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { enforceMode, structuredCompaction, COMPACTION_SECTIONS, TodoSchema } from "./session-state.js";
import { applyEdits, Checkpoints } from "./workspace.js";
import type { Sandbox } from "./sandbox.js";
import { randomUUID } from "node:crypto";

describe("permission modes", () => {
  it("enforces Plan at Tools.call before write handlers run", async () => {
    process.env.MASTER_KEY = "a".repeat(64);
    process.env.DASH_TOKEN = "workflow-test-dash-token-123456789";
    const dir = await mkdtemp(path.join(os.tmpdir(), "pansa-plan-"));
    process.env.PANSA_HOME = path.join(dir, ".pansa");
    process.env.WORKSPACE_DIR = dir;
    process.env.EXEC_MODE = "host";
    const { Store } = await import("./store.js");
    const { Tools } = await import("./tools.js");
    const { Skills } = await import("./skills.js");
    const db = new Store(":memory:");
    try {
      const sandbox = { root: async () => dir } as unknown as Sandbox;
      const tools = new Tools(db, sandbox, new Skills());
      const session = db.session().id;
      tools.state.set(session, "mode", "plan");
      await writeFile(path.join(dir, "existing.txt"), "original");
      const ctx = { session, signal: AbortSignal.timeout(3000), depth: 0 };
      await expect(tools.call("write_file", { path: "existing.txt", content: "changed" }, ctx)).rejects.toThrow("mode Plan: hanya baca");
      expect(await readFile(path.join(dir, "existing.txt"), "utf8")).toBe("original");
      expect(await tools.call("read_file", { path: "existing.txt" }, ctx)).toBe("original");
      await expect(tools.call("bash", { command: "touch forbidden" }, ctx)).rejects.toThrow("mode Plan: hanya baca");
    } finally { db.db.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it("runs host shell without Docker and preserves cwd across calls", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pansa-host-shell-"));
    try {
      const { Sandbox } = await import("./sandbox.js");
      const sandbox = new Sandbox();
      const session = randomUUID();
      sandbox.setRoot(session, dir);
      const signal = AbortSignal.timeout(5000);
      expect(await sandbox.run(session, "pwd", signal)).toContain(dir);
      await sandbox.run(session, "mkdir -p nested && cd nested", signal);
      expect(await sandbox.run(session, "pwd", signal)).toContain(path.join(dir, "nested"));
      expect(await sandbox.run(session, "pwd", signal, 5000, true)).toContain(dir);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("blocks writes and shell in Plan and Explore; permits reads", () => {
    for (const tool of ["write_file", "bash", "multi_edit", "remote__write", "git_commit"])
      expect(() => enforceMode("plan", tool)).toThrow("mode Plan: hanya baca");
    expect(() => enforceMode("build", "write_file", "explore")).toThrow();
    for (const tool of ["read_file", "glob", "grep", "file_outline"])
      expect(() => enforceMode("plan", tool)).not.toThrow();
  });
});
describe("atomic multi-edit", () => {
  it("does not save partial changes when any replacement fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pansa-edit-"));
    try {
      const file = path.join(dir, "test.ts"), original = "const a = 1;\nconst b = 2;\n";
      await writeFile(file, original);
      await expect((async () => {
        const next = applyEdits(await readFile(file, "utf8"), [{ old: "a = 1", replacement: "a = 3" }, { old: "missing", replacement: "bad" }]);
        await writeFile(file, next);
      })()).rejects.toThrow("semua edit dibatalkan");
      expect(await readFile(file, "utf8")).toBe(original);
      expect(applyEdits(original, [{ old: "a = 1", replacement: "a = 3" }])).toContain("a = 3");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
describe("structured compaction", () => {
  it("retains all five sections including decisions, files and pending work", () => {
    const text = structuredCompaction(["Build app", "Owner chose A", "src/a.ts modified", "Test pending", "Not deployed"]);
    for (const section of COMPACTION_SECTIONS) expect(text).toContain(`## ${section}`);
    expect(text).toContain("Owner chose A"); expect(text).toContain("src/a.ts"); expect(text).toContain("Test pending");
  });
  it("rejects competing in-progress todos", () => {
    expect(() => TodoSchema.parse([{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }])).toThrow();
  });
});
describe("checkpoint restore", () => {
  it("restores changed and deleted files, removes newly created files, and preserves git metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pansa-checkpoint-"));
    const { mkdir } = await import("node:fs/promises");
    const root = path.join(dir, "workspace"), home = path.join(dir, "home");
    await mkdir(root); await mkdir(home); await mkdir(path.join(root, ".git"));
    const sandbox = { root: async () => root, home: async () => home } as unknown as Sandbox;
    const checkpoints = new Checkpoints(sandbox);
    try {
      await writeFile(path.join(root, "a"), "A"); await writeFile(path.join(root, "b"), "B");
      await writeFile(path.join(root, ".git", "config"), "preserve");
      const cp = await checkpoints.create("test", "before");
      await writeFile(path.join(root, "a"), "changed"); await rm(path.join(root, "b")); await writeFile(path.join(root, "c"), "new");
      expect((await checkpoints.changes("test", cp.id)).changed.sort()).toEqual(["a", "b", "c"]);
      await checkpoints.restore("test", cp.id);
      expect(await readFile(path.join(root, "a"), "utf8")).toBe("A");
      expect(await readFile(path.join(root, "b"), "utf8")).toBe("B");
      await expect(readFile(path.join(root, "c"))).rejects.toThrow();
      expect(await readFile(path.join(root, ".git", "config"), "utf8")).toBe("preserve");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
describe("work budget", () => {
  it("pauses while waiting for the owner and resumes afterwards", async () => {
    const { WorkBudget } = await import("./budget.js");
    const budget = new WorkBudget(300);
    budget.hold();
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(budget.signal.aborted).toBe(false);
    budget.release();
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
  });
});

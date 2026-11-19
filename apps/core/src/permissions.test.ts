import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { permissionRule } from "./permissions.js";
import type { Sandbox } from "./sandbox.js";
import type { Agent } from "./agent.js";

afterEach(() => vi.unstubAllEnvs());
async function setup() {
  vi.stubEnv("MASTER_KEY", "a".repeat(64));
  vi.stubEnv("DASH_TOKEN", "permission-test-dashboard-token-12345");
  const { Store } = await import("./store.js");
  const { Tools } = await import("./tools.js");
  const { Skills } = await import("./skills.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "pansa-permissions-"));
  let activeRoot = root;
  const store = new Store(":memory:");
  const sandbox = { root: async () => activeRoot } as Sandbox;
  const tools = new Tools(store, sandbox, new Skills());
  const builtinWrite = tools.registry.get("write_file")!;
  const session = store.session().id;
  const run = vi.fn(async () => "ok");
  for (const name of ["bash", "run_python", "write_file", "http_request"])
    tools.add({ name, description: name, schema: z.record(z.unknown()), run });
  const signal = AbortSignal.timeout(10000);
  const call = (name: string, args: Record<string, unknown>, id = session) => tools.call(name, args, { session: id, signal, depth: 0 });
  const pending = () => [...tools.pending.keys()][0]!;
  const nextApproval = async () => { await vi.waitFor(() => expect(tools.pending.size).toBe(1)); return pending(); };
  return { store, tools, sandbox, builtinWrite, root, run, session, call, pending, nextApproval, setRoot: (value: string) => { activeRoot = value; }, cleanup: async () => { store.db.close(); await rm(root, { recursive: true, force: true }); } };
}

describe("permission policies", () => {
  it("only exempts exact simple read commands, never substitutions or arbitrary shell syntax", () => {
    expect(permissionRule("bash", { command: "pwd" })).toBeNull();
    for (const command of ["pwd; touch changed", "ls $(touch changed)", "ls > changed", "git status --short && curl example.com", "ls /etc/shadow"])
      expect(permissionRule("bash", { command })?.scope === "execution" || permissionRule("bash", { command })?.alwaysAsk).toBe(true);
  });
  it("keeps destructive commands, external writes, and MCP outside remembered grants", () => {
    for (const command of ["rm notes.txt", "sudo apt install nodejs", "git push origin main", "git reset --hard"])
      expect(permissionRule("bash", { command })?.alwaysAsk).toBe(true);
    expect(permissionRule("http_request", { method: "POST" })?.alwaysAsk).toBe(true);
    expect(permissionRule("remote__tool", {})?.alwaysAsk).toBe(true);
  });
});

describe("session permission grants", () => {
  it("keeps bundled permission commands available when the user has no custom commands directory", async () => {
    const h = await setup();
    try {
      const { Commands } = await import("./commands.js");
      const commands = new Commands({ tools: h.tools, store: h.store } as Agent);
      const result = await commands.execute(h.session, "/permissions");
      expect(result?.response).toContain("Active session permissions");
      h.store.run("UPDATE sessions SET auto_approve=1 WHERE id=?", h.session);
      await commands.execute(h.session, "/permissions reset");
      expect(h.store.get("SELECT auto_approve FROM sessions WHERE id=?", h.session)?.auto_approve).toBe(0);
    } finally { await h.cleanup(); }
  });
  it("does not execute a project formatter before execution permission is granted", async () => {
    const h = await setup();
    try {
      h.tools.add(h.builtinWrite);
      const run = vi.fn(async () => "exit=0"); h.sandbox.run = run;
      await h.call("write_file", { path: "one.ts", content: "const one = 1;" });
      expect(run).not.toHaveBeenCalled();
      const task = h.call("bash", { command: "npm test" }); h.tools.decide(await h.nextApproval(), true, "session"); await task;
      await h.call("write_file", { path: "one.ts", content: "const one = 2;" });
      expect(run).toHaveBeenCalledOnce();
    } finally { await h.cleanup(); }
  });
  it("allows built-in workspace edits in Build, but Plan still blocks them", async () => {
    const h = await setup();
    try {
      await expect(h.call("write_file", { path: "note.txt", content: "hello" })).resolves.toBe("ok");
      h.tools.state.set(h.session, "mode", "plan");
      await expect(h.call("write_file", { path: "note.txt", content: "changed" })).rejects.toThrow("Plan mode");
      expect(h.run).toHaveBeenCalledOnce();
    } finally { await h.cleanup(); }
  });
  it("remembers execution for this session and root, while once does not grant later calls", async () => {
    const h = await setup();
    try {
      const first = h.call("bash", { command: "python3 analyze.py" });
      h.tools.decide(await h.nextApproval(), true, "once");
      await first;
      const second = h.call("run_python", { code: "print(1)" });
      h.tools.decide(await h.nextApproval(), true, "session");
      await second;
      await expect(h.call("bash", { command: "npm test" })).resolves.toBe("ok");
      expect(h.tools.pending.size).toBe(0);
      expect(h.tools.permissions(h.session)).toEqual([{ root: h.root, scope: "execution" }]);
      h.tools.revokePermissions(h.session);
      const third = h.call("run_python", { code: "print(2)" });
      h.tools.decide(await h.nextApproval(), false);
      await expect(third).rejects.toThrow("denied");
    } finally { await h.cleanup(); }
  });
  it("does not carry grants across sessions or workspace changes", async () => {
    const h = await setup();
    try {
      const first = h.call("bash", { command: "npm test" });
      h.tools.decide(await h.nextApproval(), true, "session"); await first;
      const otherSession = h.store.session().id;
      const other = h.call("bash", { command: "npm test" }, otherSession);
      h.tools.decide(await h.nextApproval(), false); await expect(other).rejects.toThrow("denied");
      const otherRoot = path.join(h.root, "other"); await mkdir(otherRoot); h.setRoot(otherRoot);
      const moved = h.call("bash", { command: "npm test" });
      h.tools.decide(await h.nextApproval(), false); await expect(moved).rejects.toThrow("denied");
    } finally { await h.cleanup(); }
  });
  it("refuses session grants for protected actions and does not execute on denial", async () => {
    const h = await setup();
    try {
      const task = h.call("http_request", { url: "https://example.com", method: "POST" });
      const id = await h.nextApproval();
      expect(h.tools.approvalInfo(id).allowSession).toBe(false);
      expect(() => h.tools.decide(id, true, "session")).toThrow("one-time");
      expect(h.tools.pending.has(id)).toBe(true);
      h.tools.decide(id, false);
      await expect(task).rejects.toThrow("denied"); expect(h.run).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
  it("Ask mode ignores remembered execution grants", async () => {
    const h = await setup();
    try {
      const task = h.call("bash", { command: "npm test" }); h.tools.decide(await h.nextApproval(), true, "session"); await task;
      h.tools.state.set(h.session, "mode", "ask");
      const next = h.call("bash", { command: "npm test" }); const id = await h.nextApproval();
      expect(h.tools.approvalInfo(id).allowSession).toBe(false); h.tools.decide(id, false); await expect(next).rejects.toThrow("denied");
    } finally { await h.cleanup(); }
  });
  it("does not execute if the workspace changes while the user is reviewing approval", async () => {
    const h = await setup();
    try {
      const task = h.call("bash", { command: "npm test" }); const id = await h.nextApproval();
      const moved = path.join(h.root, "moved"); await mkdir(moved); h.setRoot(moved);
      h.tools.decide(id, true, "session");
      await expect(task).rejects.toThrow("Workspace changed"); expect(h.run).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
  it("rechecks Plan mode after the user approves a pending execution", async () => {
    const h = await setup();
    try {
      const task = h.call("bash", { command: "npm test" }); const id = await h.nextApproval();
      h.tools.state.set(h.session, "mode", "plan"); h.tools.decide(id, true);
      await expect(task).rejects.toThrow("Plan mode"); expect(h.run).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

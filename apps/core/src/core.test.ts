import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encrypt, decrypt, safePath, redact, checkURL } from "./security.js";
import { Store } from "./store.js";
import { Providers, quality, cooldown, type Message } from "./providers.js";const key = "a".repeat(64);
afterEach(() => vi.restoreAllMocks());
describe("encryption", () => {
  it("uses unique nonces and rejects tampering/wrong key", () => {
    const a = encrypt("secret-provider-key", key),
      b = encrypt("secret-provider-key", key);
    expect(a).not.toEqual(b);
    expect(decrypt(a, key)).toBe("secret-provider-key");
    expect(() => decrypt(a, "b".repeat(64))).toThrow();
    const parts = a.split(".");
    parts[1] = Buffer.alloc(16).toString("base64");
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });
  it("redacts stored secrets in events", () => {
    const db = new Store(":memory:");
    db.secrets = ["private-key"];
    const event = db.event("message", null, { content: "private-key" });
    expect(JSON.stringify(event)).not.toContain("private-key");
    db.db.close();
  });
});
describe("sandbox guard", () => {
  it("blocks traversal, absolute paths and escaping symlinks", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pansa-test-"));
    try {
      await writeFile(path.join(dir, "ok"), "a");
      await symlink("/tmp", path.join(dir, "escape"));
      expect(await safePath(dir, "ok")).toBe(path.join(dir, "ok"));
      await expect(safePath(dir, "../secret")).rejects.toThrow();
      await expect(safePath(dir, "/etc/passwd")).rejects.toThrow();
      await expect(safePath(dir, "escape/secret")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("blocks private network and metadata URLs", async () => {
    for (const url of [
      "http://127.0.0.1",
      "http://169.254.169.254",
      "http://[::1]",
      "file:///etc/passwd",
    ])
      await expect(checkURL(url)).rejects.toThrow();
  });
});
describe("memory", () => {
  it("searches facts and keeps FTS consistent on edit and delete", () => {
    const db = new Store(":memory:");
    const id = db.remember("game", "threejs collision physics");
    expect(db.recall("physics")[0]?.id).toBe(id);
    db.run("UPDATE memory SET content=? WHERE id=?", "canvas renderer", id);
    expect(db.recall("physics")).toHaveLength(0);
    expect(db.recall("renderer")[0]?.id).toBe(id);
    db.run("DELETE FROM memory WHERE id=?", id);
    expect(db.recall("renderer")).toHaveLength(0);
    db.db.close();
  });
});
describe("provider manager", () => {  it("rejects empty/refusal/repetitive/malformed responses", () => {
    expect(quality("", [], [])).toBe(0);
    expect(quality("Sorry, I cannot help.", [], [])).toBeLessThan(0.5);
    expect(
      quality(
        "This is a repeated phrase with enough characters. ".repeat(4),
        [],
        [],
      ),
    ).toBeLessThan(0.5);
    expect(
      quality(
        "",
        [
          {
            id: "1",
            type: "function",
            function: { name: "unknown", arguments: "{bad" },
          },
        ],
        [],
      ),
    ).toBe(0);
    expect(quality("Task selesai dan test berhasil.", [], [])).toBe(1);
  });
  it("caps exponential cooldown at thirty minutes", () => {
    expect(cooldown(0)).toBe(120000);
    expect(cooldown(1)).toBe(240000);
    expect(cooldown(100)).toBe(1800000);
  });
  it("fails over with identical context and opens circuit after two failures", async () => {
    const db = new Store(":memory:"),
      manager = new Providers(db, key);
    const a = manager.save({
        name: "a",
        model: "a",
        base_url: "https://example.com",
        priority: 0,
      }),
      b = manager.save({
        name: "b",
        model: "b",
        base_url: "https://example.com",
        priority: 1,
      });
    const seen: Message[][] = [];
    vi.spyOn(manager, "request").mockImplementation(async (p, m) => {
      seen.push(m);
      if (p.id === a) throw new Error("HTTP 500");
      return { text: "Task selesai dengan benar.", calls: [], tokens: 10 };
    });
    const history: Message[] = [{ role: "user", content: "build game" }];
    const result = await manager.complete(
      history,
      [],
      "test",
      AbortSignal.timeout(5000),
      () => {},
    );
    expect(result.provider).toBe(b);
    expect(seen).toEqual([history, history, history]);
    expect(
      Number(
        db.get("SELECT cooldown_until FROM providers WHERE id=?", a)
          ?.cooldown_until,
      ),
    ).toBeGreaterThan(Date.now());
    expect(db.get("SELECT COUNT(*) n FROM events WHERE type='switch'")?.n).toBe(
      1,
    );
    db.db.close();
  });
});
describe("session purge", () => {
  it("removes the session and every row bound to it, keeping other sessions", async () => {
    Object.assign(process.env, {
      MASTER_KEY: key,
      DASH_TOKEN: "test-dash-token-0123456789abcdef",
      DATA_DIR: "/tmp/pansa-purge-test",
      WORKSPACE_DIR: "/tmp/pansa-purge-test",
    });
    const { Agent } = await import("./agent.js");
    const db = new Store(":memory:");
    const providers = new Providers(db, key);
    const killed: string[] = [];
    const tools = {
      pending: new Map<string, (ok: boolean) => void>(),
      sandbox: {
        kill: async (s: string) => {
          killed.push(s);
          return 1;
        },
      },
    } as unknown as ConstructorParameters<typeof Agent>[2];
    const agent = new Agent(db, providers, tools);
    const keep = String(db.session("keep").id);
    const gone = String(db.session("gone").id);
    db.run(
      "INSERT INTO messages(session_id,payload) VALUES(?,?)",
      gone,
      JSON.stringify({ role: "user", content: "hi" }),
    );
    db.event("task", gone, { status: "running", prompt: "x" });
    db.remember("k", "v", "fact", gone);
    db.run(
      "INSERT INTO approvals(id,session_id,tool,args) VALUES(?,?,?,?)",
      "approval-1",
      gone,
      "run_command",
      "{}",
    );
    db.run(
      "INSERT INTO schedules(id,cron,prompt,session_id) VALUES(?,?,?,?)",
      "schedule-1",
      "0 9 * * *",
      "prompt",
      gone,
    );
    db.run(
      "INSERT INTO bounties(id,title,session_id) VALUES(?,?,?)",
      "bounty-1",
      "b",
      gone,
    );
    expect(await agent.purge(gone)).toBe(true);
    expect(killed).toContain(gone);
    for (const table of [
      "messages",
      "events",
      "memory",
      "approvals",
      "schedules",
    ])
      expect(
        db.get(`SELECT COUNT(*) n FROM ${table} WHERE session_id=?`, gone)?.n,
      ).toBe(0);
    expect(db.get("SELECT COUNT(*) n FROM sessions WHERE id=?", gone)?.n).toBe(
      0,
    );
    expect(
      db.get("SELECT session_id FROM bounties WHERE id='bounty-1'")?.session_id,
    ).toBe(null);
    expect(db.get("SELECT COUNT(*) n FROM sessions WHERE id=?", keep)?.n).toBe(
      1,
    );
    expect(await agent.purge(gone)).toBe(false);
    db.db.close();
  });
});

describe("agent stop", () => {
  it("reports idle without inventing events and reaps a stale running task", async () => {
    Object.assign(process.env, {
      MASTER_KEY: key,
      DASH_TOKEN: "test-dash-token-0123456789abcdef",
      DATA_DIR: "/tmp/pansa-stop-test",
      WORKSPACE_DIR: "/tmp/pansa-stop-test",
    });
    const { Agent } = await import("./agent.js");
    const db = new Store(":memory:");
    const providers = new Providers(db, key);
    const tools = {
      pending: new Map<string, (ok: boolean) => void>(),
      sandbox: { kill: async () => 0 },
    } as unknown as ConstructorParameters<typeof Agent>[2];
    const agent = new Agent(db, providers, tools);
    const session = String(db.session("stop test").id);
    expect(agent.stopOrReap(session)).toBe("idle");
    expect(db.get("SELECT COUNT(*) n FROM events WHERE type='task'")?.n).toBe(0);
    db.event("task", session, { status: "running", prompt: "x" });
    expect(agent.stopOrReap(session)).toBe("reaped");
    const last = db.get(
      "SELECT data FROM events WHERE session_id=? AND type='task' ORDER BY id DESC LIMIT 1",
      session,
    );
    expect(JSON.parse(String(last?.data)).status).toBe("stopped");
    db.db.close();
  });
});

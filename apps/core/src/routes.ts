import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { safePath, hash, encrypt } from "./security.js";
import type { Store } from "./store.js";
import type { Tools } from "./tools.js";
import type { Providers } from "./providers.js";
import type { Agent } from "./agent.js";
export async function routes(
  app: FastifyInstance,
  store: Store,
  tools: Tools,
  providers: Providers,
  agent: Agent,
) {
  await app.register(multipart, { limits: { fileSize: 20_000_000, files: 1 } });
  app.get("/api/tools", async () =>
    [...tools.registry.values()].map(({ name, description, risky }) => ({
      name,
      description,
      risky,
      enabled: store.setting(`tool.${name}`, "true") === "true",
    })),
  );
  app.patch("/api/tools/:name", async (req) => {
    const { name } = req.params as { name: string };
    if (!tools.registry.has(name)) throw new Error("Tool tidak ditemukan");
    const b = z.object({ enabled: z.boolean() }).parse(req.body);
    store.set(`tool.${name}`, String(b.enabled));
    return { ok: true };
  });
  app.get("/api/schedules", async () => store.all("SELECT * FROM schedules"));
  app.post("/api/schedules", async (req) => {
    const b = z
      .object({
        cron: z.string().min(5).max(120),
        prompt: z.string().trim().min(1).max(20000),
        session_id: z.string().min(1),
        enabled: z.boolean().default(true),
      })
      .parse(req.body);
    const { CronExpressionParser } = await import("cron-parser");
    CronExpressionParser.parse(b.cron);
    if (!store.get("SELECT id FROM sessions WHERE id=?", b.session_id))
      throw Object.assign(new Error("Session tidak ditemukan"), {
        statusCode: 404,
      });
    const id = randomBytes(9).toString("hex");
    store.run(
      "INSERT INTO schedules(id,cron,prompt,session_id,enabled) VALUES(?,?,?,?,?)",
      id,
      b.cron,
      b.prompt,
      b.session_id,
      Number(b.enabled),
    );
    return { id };
  });
  app.patch("/api/schedules/:id", async (req) => {
    const b = z.object({ enabled: z.boolean() }).parse(req.body);
    store.run(
      "UPDATE schedules SET enabled=? WHERE id=?",
      Number(b.enabled),
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });
  app.delete("/api/schedules/:id", async (req) => {
    store.run(
      "DELETE FROM schedules WHERE id=?",
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });
  app.get("/api/system", async () => ({
    memory: process.memoryUsage(),
    system: { total: os.totalmem(), free: os.freemem(), load: os.loadavg() },
    uptime: process.uptime(),
    sandbox: config.ALLOW_UNSANDBOXED === "true" ? "host" : "docker",
  }));
  app.get("/api/sessions/:id/messages", async (req) =>
    store.all(
      "SELECT * FROM messages WHERE session_id=? ORDER BY id",
      (req.params as { id: string }).id,
    ),
  );
  app.patch("/api/sessions/:id", async (req) => {
    const b = z
      .object({
        auto_approve: z.boolean(),
        pinned: z.string().nullable().default(null),
        strict: z.boolean().default(false),
      })
      .parse(req.body);
    store.run(
      "UPDATE sessions SET auto_approve=?,pinned=?,strict=? WHERE id=?",
      Number(b.auto_approve),
      b.pinned,
      Number(b.strict),
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });
  app.get("/api/sessions/:id/files", async (req, reply) => {
    const { id } = req.params as { id: string };
    let p: string;
    try {
      const root = await tools.sandbox.root(id);
      p = await safePath(
        root,
        String((req.query as { path?: string }).path ?? "."),
      );
    } catch {
      return reply.code(400).send({ error: "Path di luar workspace ditolak" });
    }
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) return reply.code(404).send({ error: "File tidak ditemukan" });
    if (stat.isDirectory())
      return (await fs.readdir(p, { withFileTypes: true })).map((f) => ({
        name: f.name,
        directory: f.isDirectory(),
      }));
    if (stat.size > 20e6) throw new Error("File terlalu besar");
    return {
      name: path.basename(p),
      content: (await fs.readFile(p)).toString("base64"),
    };
  });
  app.post("/api/sessions/:id/upload", async (req) => {
    const root = await tools.sandbox.root((req.params as { id: string }).id),
      file = await req.file();
    if (!file) throw new Error("File diperlukan");
    const dest = await safePath(root, path.basename(file.filename));
    await fs.writeFile(dest, await file.toBuffer());
    return { path: path.basename(dest) };
  });
  app.patch("/api/providers/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const b = z
      .object({
        enabled: z.boolean().optional(),
        priority: z.number().int().optional(),
      })
      .parse(req.body);
    if (b.enabled !== undefined)
      store.run(
        "UPDATE providers SET enabled=? WHERE id=?",
        Number(b.enabled),
        id,
      );
    if (b.priority !== undefined)
      store.run("UPDATE providers SET priority=? WHERE id=?", b.priority, id);
    return { ok: true };
  });
  app.put("/api/memory/:id", async (req) => {
    const b = z
      .object({ key: z.string(), content: z.string() })
      .parse(req.body);
    store.run(
      "UPDATE memory SET key=?,content=? WHERE id=?",
      b.key,
      b.content,
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });
  app.post("/api/memory/import", async (req) => {
    const entries = z
      .array(
        z.object({
          key: z.string(),
          content: z.string(),
          kind: z.enum(["fact", "note", "episodic"]).default("fact"),
        }),
      )
      .max(10000)
      .parse(req.body);
    store.db.transaction(() => {
      for (const e of entries) store.remember(e.key, e.content, e.kind);
    })();
    return { count: entries.length };
  });
  app.post("/api/backup", async () => {
    const file = path.join(config.data, `backup-${Date.now()}.sqlite`);
    await store.db.backup(file);
    return { file: path.basename(file) };
  });
  app.get("/api/settings", async () => ({
    makefun_base_url: store.setting("makefun_base_url", ""),
    makefun_credentials: store.setting("makefun_credentials")
      ? "tersimpan"
      : "",
    max_steps: Number(store.setting("max_steps", String(config.MAX_STEPS))),
    sandbox: config.ALLOW_UNSANDBOXED === "true" ? "host" : "docker",
    sandbox_network: config.SANDBOX_NETWORK === "true",
    telegram: Boolean(config.BOT_TOKEN),
    public_url: config.PUBLIC_URL,
  }));
  app.post("/api/settings", async (req) => {
    const b = z
      .object({
        makefun_base_url: z.string().url().optional(),
        makefun_credentials: z.string().optional(),
        max_steps: z.number().int().min(1).max(100).optional(),
      })
      .parse(req.body);
    if (b.makefun_base_url) store.set("makefun_base_url", b.makefun_base_url);
    if (b.makefun_credentials)
      store.set(
        "makefun_credentials",
        encrypt(b.makefun_credentials, config.MASTER_KEY),
      );
    if (b.max_steps) store.set("max_steps", String(b.max_steps));
    return { ok: true };
  });
  app.post("/api/scheduler/tick", async () => {
    const { CronExpressionParser } = await import("cron-parser");
    let started = 0;
    for (const s of store.all("SELECT * FROM schedules WHERE enabled=1")) {
      if (agent.running.has(String(s.session_id))) continue;
      const next = CronExpressionParser.parse(String(s.cron), {
        currentDate: new Date(Number(s.last_run) || Date.now() - 60000),
      })
        .next()
        .getTime();
      if (next <= Date.now()) {
        store.run(
          "UPDATE schedules SET last_run=? WHERE id=?",
          Date.now(),
          String(s.id),
        );
        void agent
          .run(String(s.session_id), String(s.prompt))
          .catch((e) =>
            store.event("error", String(s.session_id), { error: String(e) }),
          );
        started++;
      }
    }
    for (const p of providers.list())
      if (Number(p.cooldown_until) > 0 && Number(p.cooldown_until) < Date.now())
        await providers.test(String(p.id)).catch(() => {});
    return { started };
  });
}

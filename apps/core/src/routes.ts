import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { isWithinAllowlist, safePath, hash } from "./security.js";
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
    sandbox: config.EXEC_MODE,
    exec_mode: config.EXEC_MODE,
    workspace_dir: config.workspace,
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
  app.put("/api/sessions/:id/workspace", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip) || req.headers.origin)
      return reply.code(403).send({ error: "Pengaturan direktori CLI hanya tersedia melalui API lokal" });
    if (config.EXEC_MODE !== "host") return reply.code(409).send({ error: "Direktori per session hanya tersedia di mode host" });
    if (!store.get("SELECT id FROM sessions WHERE id=?", id)) return reply.code(404).send({ error: "Session tidak ditemukan" });
    const { directory } = z.object({ directory: z.string().min(1).max(4096) }).parse(req.body);
    const target = await fs.realpath(path.resolve(directory)).catch(() => null);
    if (!target || !(await fs.stat(target).catch(() => null))?.isDirectory()) return reply.code(400).send({ error: "Direktori proyek tidak ditemukan" });
    const allowed = await Promise.all(config.workspaceAllowlist.map((root) => fs.realpath(root).catch(() => null)));
    if (!isWithinAllowlist(target, allowed.filter((root): root is string => Boolean(root))))
      return reply.code(403).send({ error: "Direktori tidak ada dalam WORKSPACE_ALLOWLIST" });
    tools.sandbox.setRoot(id, target);
    return { directory: target };
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
    return tools.profile.updateMemory((req.params as { id: string }).id, b.key, b.content);
  });
  app.get("/api/memory/export", async () => store.all("SELECT id,key,content,kind,category,source_type,source_session,created_at FROM memory WHERE kind<>'episodic' AND profile_doc IS NULL ORDER BY created_at"));
  app.post("/api/memory/import", async (req) => {
    const entries = z
      .array(
        z.object({
          key: z.string(),
          content: z.string(),
          kind: z.enum(["fact", "fakta", "note", "episodic", "preference", "preferensi", "decision", "keputusan", "commitment", "komitmen", "relationship", "hubungan"]).default("fact"),
        }),
      )
      .max(10000)
      .parse(req.body);
    for (const entry of entries) {
      if (["fact", "fakta", "preference", "preferensi", "decision", "keputusan", "commitment", "komitmen", "relationship", "hubungan"].includes(entry.kind))
        await tools.profile.saveMemory(({ fact: "fakta", preference: "preferensi", decision: "keputusan", commitment: "komitmen", relationship: "hubungan" } as Record<string, string>)[entry.kind] ?? entry.kind, entry.key, entry.content);
      else store.remember(entry.key, entry.content, entry.kind);
    }
    return { count: entries.length };
  });
  app.post("/api/backup", async () => {
    const file = path.join(config.data, `backup-${Date.now()}.sqlite`);
    await store.db.backup(file);
    return { file: path.basename(file) };
  });
  app.get("/api/profile/:document", async (req) => {
    const document = z.enum(["soul", "user", "memory"]).parse((req.params as { document: string }).document);
    return { document, content: await tools.profile.read(document) };
  });
  app.put("/api/profile/:document", async (req) => {
    const document = z.enum(["soul", "user", "memory"]).parse((req.params as { document: string }).document);
    const { content } = z.object({ content: z.string().max(200000) }).parse(req.body);
    await tools.profile.write(document, content);
    return { ok: true };
  });
  app.get("/api/settings", async () => ({
    max_steps: Number(store.setting("max_steps", String(config.MAX_STEPS))),
    timezone: store.setting("timezone", "Asia/Jakarta"),
    sandbox: config.EXEC_MODE,
    exec_mode: config.EXEC_MODE,
    workspace_dir: config.workspace,
    sandbox_network: config.SANDBOX_NETWORK === "true",
    telegram: Boolean(config.BOT_TOKEN),
    public_url: config.PUBLIC_URL,
  }));
  app.post("/api/settings", async (req) => {
    const b = z
      .object({
        max_steps: z.number().int().min(1).max(100).optional(),
        timezone: z
          .string()
          .min(1)
          .max(64)
          .refine(
            (value) => {
              try {
                new Intl.DateTimeFormat("id-ID", {
                  timeZone: value,
                }).format(new Date());
                return true;
              } catch {
                return false;
              }
            },
            { message: "Zona waktu IANA tidak valid" },
          )
          .optional(),
      })
      .parse(req.body);
    if (b.max_steps) store.set("max_steps", String(b.max_steps));
    if (b.timezone) store.set("timezone", b.timezone);
    return { ok: true };
  });
  app.post("/api/scheduler/tick", async () => {
    const { CronExpressionParser } = await import("cron-parser");
    let started = 0;
    for (const s of store.all("SELECT * FROM schedules WHERE enabled=1")) {
      try {
        if (agent.running.has(String(s.session_id))) continue;
        const next = CronExpressionParser.parse(String(s.cron), {
          currentDate: new Date(Number(s.last_run) || Date.now() - 60000),
        }).next().getTime();
        if (next <= Date.now()) {
          store.run("UPDATE schedules SET last_run=? WHERE id=?", Date.now(), String(s.id));
          void agent.run(String(s.session_id), String(s.prompt)).then(result => tools.send(`Pengingat: ${result}`)).catch((e) => agent.fail(String(s.session_id), e));
          started++;
        }
      } catch (error) { store.event("error", String(s.session_id), { error: `Jadwal ${s.id} gagal: ${error instanceof Error ? error.message : "cron tidak valid"}` }); }
    }
    for (const p of providers.list())
      if (Number(p.cooldown_until) > 0 && Number(p.cooldown_until) < Date.now())
        await providers.test(String(p.id)).catch(() => {});
    return { started };
  });
}

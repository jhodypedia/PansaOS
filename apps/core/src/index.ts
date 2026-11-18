import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { WebSocketServer, WebSocket } from "ws";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { Store } from "./store.js";
import { Providers } from "./providers.js";
import { Sandbox } from "./sandbox.js";
import { Skills } from "./skills.js";
import { Tools } from "./tools.js";
import { Agent } from "./agent.js";
import { startTelegram } from "./telegram.js";
import { equal } from "./security.js";
import { hash } from "./security.js";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { routes } from "./routes.js";
import { tolerantJsonBody } from "./body.js";
import chokidar from "chokidar";
import { z } from "zod";

await mkdir(config.data, { recursive: true });
await mkdir(config.workspace, { recursive: true });
const store = new Store(path.join(config.data, "pansaos.sqlite"));
const providers = new Providers(store, config.MASTER_KEY);
const skills = new Skills();
const sandbox = new Sandbox();
const tools = new Tools(store, sandbox, skills);
const agent = new Agent(store, providers, tools);
const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
    ],
  },
});
await app.register(helmet, { contentSecurityPolicy: false });
tolerantJsonBody(app);
await app.register(cookie);
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(cors, { origin: [config.PUBLIC_URL], credentials: true });
const clients = new Set<WebSocket>();
store.bus.on("event", (event) => {
  const data = JSON.stringify(event);
  for (const client of clients)
    if (client.readyState === WebSocket.OPEN) client.send(data);
});
if (!store.setting("admin_hash"))
  store.set("admin_hash", await bcrypt.hash(config.DASH_TOKEN, 12));
function validSession(token: string) {
  return Boolean(
    token &&
    store.get(
      "SELECT token FROM auth WHERE token=? AND expires>? AND one_time=0",
      hash(token),
      Date.now(),
    ),
  );
}
const auth = async (req: {
  headers: Record<string, unknown>;
  cookies: Record<string, string | undefined>;
}): Promise<boolean> => {
  const bearer = String(req.headers.authorization ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  return (
    (Boolean(bearer) && equal(bearer, config.DASH_TOKEN)) ||
    validSession(req.cookies.pansa_session ?? "")
  );
};
app.get("/health", async () => ({
  ok: true,
  name: "PansaOS",
  running: agent.running.size,
  providers: providers.list().length,
}));
app.addHook("onRequest", async (req, reply) => {
  if (req.headers.origin && req.headers.origin !== config.PUBLIC_URL)
    return reply.code(403).send({ error: "Origin ditolak" });
  if (
    req.url.startsWith("/api") &&
    req.url.split("?")[0] !== "/api/auth" &&
    !(await auth(req))
  )
    return reply.code(401).send({ error: "Unauthorized" });
});
app.post(
  "/api/auth",
  { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const body = z
      .object({ token: z.string().min(1).max(512) })
      .parse(req.body);
    const input = body?.token ?? "";
    const once = store.get(
      "SELECT token FROM auth WHERE token=? AND expires>? AND one_time=1",
      hash(input),
      Date.now(),
    );
    if (!once && !(await bcrypt.compare(input, store.setting("admin_hash"))))
      return reply.code(401).send({ error: "Token salah" });
    if (once) store.run("DELETE FROM auth WHERE token=?", hash(input));
    const sessionToken = randomBytes(32).toString("hex");
    store.run(
      "INSERT INTO auth(token,expires) VALUES(?,?)",
      hash(sessionToken),
      Date.now() + 86400000,
    );
    reply.setCookie("pansa_session", sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.PUBLIC_URL.startsWith("https:"),
      maxAge: 86400,
      path: "/",
    });
    store.event("audit", null, { action: "login" });
    return { ok: true };
  },
);
app.addHook("onResponse", async (req, reply) => {
  if (req.url.startsWith("/api/") && req.method !== "GET")
    store.event("audit", null, {
      action: req.method,
      path: req.url.split("?")[0],
      status: reply.statusCode,
    });
});
await routes(app, store, tools, providers, agent);
app.setErrorHandler((error: unknown, req, reply) => {
  if (error instanceof z.ZodError)
    return reply.code(400).send({
      error: "Input tidak valid",
      fields: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  const e = error as { name?: string; message?: string; statusCode?: number };
  const status = e.statusCode ?? 500;
  req.log.error({ name: e.name, message: e.message }, "request failed");
  return reply.code(status).send({
    error:
      status < 500 && e.message
        ? e.message
        : "Permintaan gagal. Periksa log admin.",
  });
});
app.get("/api/auth/session", async () => ({ ok: true }));
app.post("/api/auth/logout", async (req, reply) => {
  store.run(
    "DELETE FROM auth WHERE token=?",
    hash(req.cookies.pansa_session ?? ""),
  );
  reply.clearCookie("pansa_session", { path: "/" });
  return { ok: true };
});
app.get("/api/events", async (req, reply) => {
  const q = req.query as {
    after?: string;
    session?: string;
    type?: string;
    before?: string;
    limit?: string;
    q?: string;
    hide?: string;
  };
  const paged = q.before !== undefined || q.limit !== undefined;
  const limit = paged
    ? Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100)
    : 300;
  const filter: string[] = [];
  const filterParams: (string | number | null)[] = [];
  if (q.session) {
    filter.push("session_id=?");
    filterParams.push(q.session);
  }
  if (q.type) {
    filter.push("type=?");
    filterParams.push(q.type);
  }
  if (q.hide) {
    const hidden = q.hide
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (hidden.length) {
      filter.push(`type NOT IN (${hidden.map(() => "?").join(",")})`);
      filterParams.push(...hidden);
    }
  }
  if (q.q) {
    filter.push("(type LIKE ? OR data LIKE ? OR session_id LIKE ?)");
    const like = `%${q.q}%`;
    filterParams.push(like, like, like);
  }
  const boundary = paged && q.before !== undefined ? "id<?" : "id>?";
  const bound = paged
    ? q.before !== undefined
      ? Number(q.before) || 0
      : 0
    : Number(q.after ?? 0) || 0;
  const where = [boundary, ...filter].join(" AND ");
  const rows = store.all(
    `SELECT * FROM events WHERE ${where} ORDER BY id DESC LIMIT ${paged ? limit + 1 : limit}`,
    bound,
    ...filterParams,
  );
  if (!paged) return rows;
  const more = rows.length > limit;
  const total =
    Number(
      store.get(
        `SELECT COUNT(*) n FROM events${filter.length ? ` WHERE ${filter.join(" AND ")}` : ""}`,
        ...filterParams,
      )?.n ?? 0,
    ) || 0;
  reply.header("x-has-more", more ? "1" : "0");
  reply.header("x-total", String(total));
  return rows.slice(0, limit);
});
app.get("/api/stats", async () => ({
  events: store.get("SELECT COUNT(*) n FROM events")?.n ?? 0,
  tokens:
    store.get(
      "SELECT COALESCE(SUM(json_extract(data,'$.tokens')),0) n FROM events WHERE type='usage'",
    )?.n ?? 0,
  cost:
    store.get(
      "SELECT COALESCE(SUM(json_extract(data,'$.cost')),0) n FROM events WHERE type='usage'",
    )?.n ?? 0,
  tools: store.get("SELECT COUNT(*) n FROM events WHERE type='tool'")?.n ?? 0,
  switches:
    store.get("SELECT COUNT(*) n FROM events WHERE type='switch'")?.n ?? 0,
  running: agent.running.size,
}));
app.get("/api/providers", async () => providers.list());
app.post("/api/providers", async (req) => providers.save(req.body));
app.delete("/api/providers/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  store.run("DELETE FROM providers WHERE id=?", id);
  providers.refreshSecrets();
  return { ok: true };
});
app.post("/api/providers/:id/test", async (req) =>
  providers.test((req.params as { id: string }).id),
);
app.get("/api/sessions", async () =>
  store
    .all(
      `SELECT s.id, s.title, s.chat_id, s.auto_approve, s.pinned, s.strict, s.created_at,
        (SELECT json_extract(e.data,'$.status') FROM events e
          WHERE e.session_id=s.id AND e.type='task' ORDER BY e.id DESC LIMIT 1) AS last_task
       FROM sessions s ORDER BY s.created_at DESC`,
    )
    .map((row) => ({
      ...row,
      running:
        agent.running.has(String(row.id)) || row.last_task === "running",
    })),
);
app.post("/api/sessions", async (req) => {
  const body = req.body as { title?: string };
  return store.session(body?.title ?? "Dashboard session");
});
app.post("/api/sessions/:id/message", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const body = z
    .object({ prompt: z.string().trim().min(1).max(100000) })
    .parse(req.body);
  if (!store.get("SELECT id FROM sessions WHERE id=?", id))
    return reply.code(404).send({ error: "Session tidak ditemukan" });
  if (agent.running.has(id))
    return reply.code(409).send({ error: "Task masih berjalan" });
  if (!body?.prompt) return reply.code(400).send({ error: "Prompt wajib" });
  void agent.run(id, body.prompt).catch((e) =>
    store.event("error", id, {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  return { accepted: true };
});
app.delete("/api/sessions/:id", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!store.get("SELECT id FROM sessions WHERE id=?", id))
    return reply.code(404).send({ error: "Session tidak ditemukan" });
  const removed = await agent.purge(id);
  return { ok: true, removed };
});
app.post("/api/sessions/:id/stop", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!store.get("SELECT id FROM sessions WHERE id=?", id))
    return reply.code(404).send({ error: "Session tidak ditemukan" });
  return { ok: true, status: agent.stopOrReap(id) };
});
app.get("/api/approvals", async () =>
  store.all(
    "SELECT * FROM approvals WHERE status='pending' ORDER BY created_at",
  ),
);
app.post("/api/approvals/:id", async (req) => {
  tools.decide(
    (req.params as { id: string }).id,
    Boolean((req.body as { approved?: boolean }).approved),
  );
  return { ok: true };
});
app.get("/api/skills", async () => skills.list());
app.post("/api/skills", async (req) =>
  skills.save(String((req.body as { markdown: string }).markdown)),
);
app.delete("/api/skills/:name", async (req) => {
  await skills.remove((req.params as { name: string }).name);
  return { ok: true };
});
app.get("/api/memory", async (req) =>
  store.recall(String((req.query as { q?: string }).q ?? "")),
);
app.delete("/api/memory/:id", async (req) => {
  store.run("DELETE FROM memory WHERE id=?", (req.params as { id: string }).id);
  return { ok: true };
});
app.get("/api/bounties", async () =>
  store.all("SELECT * FROM bounties ORDER BY created_at DESC"),
);
app.patch("/api/bounties/:id", async (req) => {
  const b = z
    .object({
      status: z.enum([
        "baru",
        "dikerjakan",
        "dites",
        "siap submit",
        "submitted",
      ]),
    })
    .parse(req.body);
  store.run(
    "UPDATE bounties SET status=? WHERE id=?",
    b.status ?? "baru",
    (req.params as { id: string }).id,
  );
  return { ok: true };
});
app.get("/api/config", async () => ({
  maxSteps: store.setting("max_steps", String(config.MAX_STEPS)),
  publicUrl: config.PUBLIC_URL,
  telegram: Boolean(config.BOT_TOKEN),
}));
tools.send = async () => {
  throw new Error("Telegram belum dikonfigurasi");
};
const stale = store.all(
  `SELECT e.session_id, e.data FROM events e
   JOIN (SELECT session_id, MAX(id) id FROM events WHERE type='task' GROUP BY session_id) m
   ON m.id = e.id
   WHERE json_extract(e.data,'$.status')='running'`,
);
for (const row of stale) {
  const id = String(row.session_id ?? "");
  if (!id || agent.running.has(id)) continue;
  store.event("task", id, {
    status: "error",
    error: "Terputus karena core restart. Kirim pesan untuk melanjutkan.",
  });
}
store.run(
  "UPDATE approvals SET status='expired' WHERE status='pending' AND created_at < datetime('now','-1 day')",
);
if (config.BOT_TOKEN)
  await startTelegram({ store, providers, skills, tools, agent, app }).catch(
    (e) =>
      app.log.error(
        { message: e instanceof Error ? e.message : "Telegram gagal" },
        "telegram initialization failed",
      ),
  );
await app.listen({ port: config.PORT, host: "0.0.0.0" });
const wss = new WebSocketServer({ noServer: true, maxPayload: 100000 });
app.server.on("upgrade", (request, socket, head) => {
  const cookies = app.parseCookie(request.headers.cookie ?? "");
  if (
    request.url?.split("?")[0] === "/ws" &&
    (!request.headers.origin || request.headers.origin === config.PUBLIC_URL) &&
    validSession(cookies.pansa_session ?? "")
  )
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  else socket.destroy();
});
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "connected" }));
  ws.on("close", () => clients.delete(ws));
});
await tools.plugins().catch((e) => app.log.warn(e, "plugin load failed"));
app.log.info({ port: config.PORT }, "PansaOS core ready");
chokidar
  .watch(config.plugins, { ignoreInitial: true })
  .on(
    "all",
    () =>
      void tools
        .plugins()
        .catch((e) => app.log.error(e, "plugin reload failed")),
  );
const shutdown = async () => {
  for (const id of agent.running.keys()) agent.stop(id);
  for (const ws of clients) ws.close();
  await app.close();
  store.db.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

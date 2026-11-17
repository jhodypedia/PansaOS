import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";
import Turndown from "turndown";
import { chromium } from "playwright";
import { config } from "./config.js";
import {
  checkURL,
  safeFetch,
  limitedBody,
  safePath,
  decrypt,
} from "./security.js";
import { Store } from "./store.js";
import { Sandbox } from "./sandbox.js";
import { Skills } from "./skills.js";
import type { Definition } from "./providers.js";

export interface ToolContext {
  session: string;
  signal: AbortSignal;
  depth: number;
}
export interface Tool {
  name: string;
  description: string;
  schema: z.ZodType;
  risky?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}
const s = z.string(),
  optionalPath = z.string().default(".");
const quote = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
export class Tools {
  registry = new Map<string, Tool>();
  pending = new Map<string, (ok: boolean) => void>();
  spawnTask: (prompt: string, ctx: ToolContext) => Promise<unknown> =
    async () => {
      throw new Error("Agent belum siap");
    };
  send: (text: string, file?: string) => Promise<unknown> = async () => {
    throw new Error("Telegram belum dikonfigurasi");
  };
  constructor(
    public store: Store,
    public sandbox: Sandbox,
    public skills: Skills,
  ) {
    this.builtins();
  }
  add(tool: Tool) {
    this.registry.set(tool.name, tool);
  }
  definitions(): Definition[] {
    return [...this.registry.values()]
      .filter((t) => this.store.setting(`tool.${t.name}`, "true") !== "false")
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: zodToJsonSchema(t.schema, {
            target: "openApi3",
          }) as Record<string, unknown>,
        },
      }));
  }
  async approval(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) {
    if (
      this.store.get(
        "SELECT auto_approve FROM sessions WHERE id=?",
        ctx.session,
      )?.auto_approve
    )
      return;
    const id = randomUUID();
    this.store.run(
      "INSERT INTO approvals(id,session_id,tool,args) VALUES(?,?,?,?)",
      id,
      ctx.session,
      name,
      JSON.stringify(args),
    );
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", abort);
        this.pending.delete(id);
        this.store.run("UPDATE approvals SET status='expired' WHERE id=?", id);
        reject(new Error("Approval dibatalkan"));
      };
      const timer = setTimeout(abort, 300000);
      ctx.signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, (ok) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", abort);
        this.pending.delete(id);
        ok ? resolve() : reject(new Error("Tool ditolak admin"));
      });
      this.store.event("approval", ctx.session, { id, tool: name, args });
    });
  }
  decide(id: string, ok: boolean) {
    if (!this.pending.has(id)) throw new Error("Approval sudah kedaluwarsa");
    this.store.run(
      "UPDATE approvals SET status=? WHERE id=?",
      ok ? "approved" : "rejected",
      id,
    );
    this.pending.get(id)?.(ok);
    this.store.event("audit", null, { action: "approval", id, approved: ok });
  }
  async call(name: string, input: unknown, ctx: ToolContext): Promise<string> {
    ctx.signal.throwIfAborted();
    const tool = this.registry.get(name);
    if (!tool || this.store.setting(`tool.${name}`, "true") === "false")
      throw new Error("Tool tidak tersedia");
    const args = tool.schema.parse(input) as Record<string, unknown>;
    if (
      tool.risky ||
      /rm\s+.*-[a-z]*r|\b(sendTransaction|transfer|payment|withdraw)\b/i.test(
        JSON.stringify(args),
      )
    )
      await this.approval(name, args, ctx);
    this.store.event("tool", ctx.session, { name, args, status: "running" });
    try {
      const result = await tool.run(args, ctx);
      const raw = typeof result === "string" ? result : JSON.stringify(result);
      const output =
        raw.slice(0, config.TOOL_OUTPUT_LIMIT) +
        (raw.length > config.TOOL_OUTPUT_LIMIT ? "\n[output dipotong]" : "");
      this.store.event("tool", ctx.session, { name, status: "done", output });
      return output;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Tool gagal";
      this.store.event("tool", ctx.session, { name, status: "error", error });
      throw e;
    }
  }
  async plugins() {
    await fs.mkdir(config.plugins, { recursive: true });
    for (const file of await fs.readdir(config.plugins))
      if (/\.(js|ts)$/.test(file)) {
        const mod = (await import(
          `${pathToFileURL(path.join(config.plugins, file)).href}?v=${Date.now()}`
        )) as { default: Tool };
        if (!mod.default?.name || !mod.default.schema)
          throw new Error(`Plugin invalid: ${file}`);
        this.add(mod.default);
      }
  }
  private builtins() {
    const add = (
      name: string,
      description: string,
      schema: z.ZodType,
      run: Tool["run"],
      risky = false,
    ) => this.add({ name, description, schema, run, risky });
    const resolve = async (c: ToolContext, p: unknown) =>
      safePath(await this.sandbox.root(c.session), String(p));
    const shell = async (a: Record<string, unknown>, c: ToolContext) =>
      this.sandbox.run(
        c.session,
        String(a.command),
        c.signal,
        Number(a.timeout ?? 60000),
      );
    add(
      "bash",
      "Run shell in isolated session Docker sandbox.",
      z.object({
        command: s,
        timeout: z.number().min(100).max(300000).default(60000),
      }),
      shell,
    );
    add(
      "read_file",
      "Read UTF-8 workspace file.",
      z.object({ path: s }),
      async (a, c) => {
        const file = await resolve(c, a.path);
        const stat = await fs.stat(file);
        if (stat.size > 2e6) throw new Error("File terlalu besar");
        return fs.readFile(file, "utf8");
      },
    );
    add(
      "write_file",
      "Write a UTF-8 workspace file.",
      z.object({ path: s, content: s }),
      async (a, c) => {
        const file = await resolve(c, a.path);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, String(a.content));
        return "File disimpan";
      },
    );
    add(
      "edit_file",
      "Replace one exact text occurrence. Reject ambiguous matches.",
      z.object({ path: s, old: s.min(1), replacement: s }),
      async (a, c) => {
        const file = await resolve(c, a.path),
          raw = await fs.readFile(file, "utf8");
        if (raw.split(String(a.old)).length !== 2)
          throw new Error("Teks harus cocok tepat satu kali");
        await fs.writeFile(
          file,
          raw.replace(String(a.old), String(a.replacement)),
        );
        return "File diperbarui";
      },
    );
    add(
      "list_files",
      "List workspace directory.",
      z.object({ path: optionalPath }),
      async (a, c) => {
        const entries = await fs.readdir(await resolve(c, a.path), {
          withFileTypes: true,
        });
        return entries.map((e) => e.name + (e.isDirectory() ? "/" : ""));
      },
    );
    add(
      "delete_file",
      "Delete workspace path after approval.",
      z.object({ path: s }),
      async (a, c) => {
        const p = await resolve(c, a.path);
        if (p === (await this.sandbox.root(c.session)))
          throw new Error("Root workspace tidak boleh dihapus");
        await fs.rm(p, { recursive: true });
        return "Dihapus";
      },
      true,
    );
    add(
      "glob",
      "Match file names in sandbox with ripgrep glob.",
      z.object({ pattern: s }),
      async (a, c) =>
        shell(
          { command: `rg --files --hidden -g ${quote(String(a.pattern))}` },
          c,
        ),
    );
    add(
      "grep",
      "Search workspace with regex in sandbox.",
      z.object({ pattern: s, path: optionalPath }),
      async (a, c) => {
        await resolve(c, a.path);
        return shell(
          {
            command: `rg -n -- ${quote(String(a.pattern))} ${quote(String(a.path))}`,
          },
          c,
        );
      },
    );
    for (const [name, bin] of [
      ["run_node", "node"],
      ["run_python", "python3"],
    ] as const)
      add(
        name,
        `Run ${bin} code inside sandbox.`,
        z.object({ code: s }),
        async (a, c) =>
          shell(
            {
              command: `${bin} ${bin === "node" ? "-e" : "-c"} ${quote(String(a.code))}`,
            },
            c,
          ),
      );
    for (const name of ["git", "npm", "lint_test"] as const)
      add(
        name,
        "Run project command inside sandbox.",
        z.object({ args: z.array(s) }),
        async (a, c) =>
          shell(
            {
              command: `${name === "lint_test" ? "npm" : name} ${(a.args as string[]).map(quote).join(" ")}`,
            },
            c,
          ),
      );
    add(
      "zip",
      "Create submission ZIP from workspace paths.",
      z.object({ output: s, paths: z.array(s).min(1) }),
      async (a, c) => {
        await resolve(c, a.output);
        for (const p of a.paths as string[]) await resolve(c, p);
        return shell(
          {
            command: `zip -r ${quote(String(a.output))} ${(a.paths as string[]).map(quote).join(" ")}`,
          },
          c,
        );
      },
    );
    add(
      "unzip",
      "Extract archive in sandbox; review untrusted archive first.",
      z.object({ path: s, destination: s }),
      async (a, c) => {
        await resolve(c, a.path);
        await resolve(c, a.destination);
        return shell(
          {
            command: `unzip -n ${quote(String(a.path))} -d ${quote(String(a.destination))}`,
          },
          c,
        );
      },
      true,
    );
    const web = async (url: string, c: ToolContext) => {
      const response = await safeFetch(
        url,
        { signal: AbortSignal.any([c.signal, AbortSignal.timeout(30000)]) },
        config.ALLOW_PRIVATE_NETWORK === "true",
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = (await limitedBody(response)).toString();
      const $ = load(raw);
      $("script,style,noscript,iframe").remove();
      return new Turndown().turndown($.html());
    };
    add(
      "web_fetch",
      "Fetch public URL as cleaned Markdown.",
      z.object({ url: s.url() }),
      async (a, c) => web(String(a.url), c),
    );
    add(
      "http_request",
      "HTTP request to public URL. Mutating methods require approval.",
      z.object({
        url: s.url(),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .default("GET"),
        headers: z.record(s).default({}),
        body: s.optional(),
      }),
      async (a, c) => {
        if (a.method !== "GET") await this.approval("http_request", a, c);
        const r = await safeFetch(
          String(a.url),
          {
            method: String(a.method),
            headers: a.headers as Record<string, string>,
            body: a.body as string | undefined,
            signal: AbortSignal.any([c.signal, AbortSignal.timeout(30000)]),
          },
          config.ALLOW_PRIVATE_NETWORK === "true",
        );
        return { status: r.status, body: (await limitedBody(r)).toString() };
      },
    );
    add(
      "web_search",
      "Search configured endpoint; query is passed as q parameter.",
      z.object({ query: s }),
      async (a, c) => {
        if (!config.SEARCH_URL)
          throw new Error(
            "Atur SEARCH_URL atau gunakan web_fetch dengan URL nyata",
          );
        const u = new URL(config.SEARCH_URL);
        u.searchParams.set("q", String(a.query));
        const r = await safeFetch(u.href, {
          headers: config.SEARCH_KEY
            ? { authorization: `Bearer ${config.SEARCH_KEY}` }
            : {},
          signal: c.signal,
        });
        return (await limitedBody(r)).toString();
      },
    );
    add(
      "download_file",
      "Download public URL to workspace, max 20 MB.",
      z.object({ url: s.url(), path: s }),
      async (a, c) => {
        const r = await safeFetch(String(a.url), { signal: c.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const file = await resolve(c, a.path);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, await limitedBody(r, 20e6));
        return String(a.path);
      },
    );
    add(
      "browser",
      "Headless browser visit and optional click/fill, screenshot and extract. Interactive actions require approval.",
      z.object({
        url: s.url(),
        click: s.optional(),
        selector: s.optional(),
        text: s.optional(),
        screenshot: s.optional(),
      }),
      async (a, c) => {
        if (a.click || a.text) await this.approval("browser", a, c);
        await checkURL(String(a.url));
        const browser = await chromium.launch({ headless: true });
        const abort = () => void browser.close();
        c.signal.addEventListener("abort", abort, { once: true });
        try {
          const context = await browser.newContext({ serviceWorkers: "block" });
          await context.route("**/*", async (route) => {
            try {
              await checkURL(route.request().url());
              await route.continue();
            } catch {
              await route.abort();
            }
          });
          const page = await context.newPage();
          await page.goto(String(a.url), { timeout: 30000 });
          if (a.click) await page.locator(String(a.click)).click();
          if (a.selector && a.text)
            await page.locator(String(a.selector)).fill(String(a.text));
          if (a.screenshot)
            await page.screenshot({
              path: await resolve(c, a.screenshot),
              fullPage: true,
            });
          return await page.locator("body").innerText();
        } finally {
          c.signal.removeEventListener("abort", abort);
          await browser.close();
        }
      },
    );
    add(
      "remember",
      "Save long-term fact or task lesson.",
      z.object({
        key: s,
        content: s,
        kind: z.enum(["fact", "note", "episodic"]).default("fact"),
      }),
      async (a, c) =>
        this.store.remember(
          String(a.key),
          String(a.content),
          String(a.kind),
          c.session,
        ),
    );
    add(
      "recall",
      "Search FTS5 long-term memory.",
      z.object({ query: s }),
      async (a) => this.store.recall(String(a.query)),
    );
    add(
      "forget",
      "Delete memory after approval.",
      z.object({ id: s }),
      async (a) =>
        this.store.run("DELETE FROM memory WHERE id=?", String(a.id)),
      true,
    );
    add(
      "list_skills",
      "List installed skill metadata.",
      z.object({}),
      async () =>
        (await this.skills.list()).map(({ content, raw, ...meta }) => meta),
    );
    add(
      "read_skill",
      "Load full skill instructions.",
      z.object({ name: s }),
      async (a) => {
        const skill = (await this.skills.list()).find((x) => x.name === a.name);
        if (!skill) throw new Error("Skill tidak ditemukan");
        return skill.raw;
      },
    );
    add(
      "create_skill",
      "Install validated Markdown skill after approval.",
      z.object({ markdown: s }),
      async (a) => this.skills.save(String(a.markdown)),
      true,
    );
    add(
      "telegram_send",
      "Send message or workspace file to configured admins.",
      z.object({ text: s, path: s.optional() }),
      async (a, c) =>
        this.send(
          String(a.text),
          a.path ? await resolve(c, a.path) : undefined,
        ),
      true,
    );
    add("notify", "Notify Telegram admins.", z.object({ text: s }), async (a) =>
      this.send(String(a.text)),
    );
    add(
      "spawn_task",
      "Delegate independent subtask. Child gets its own workspace.",
      z.object({ prompt: s }),
      async (a, c) => this.spawnTask(String(a.prompt), c),
    );
    add(
      "wait",
      "Wait up to 30 seconds, abortable.",
      z.object({ seconds: z.number().min(0).max(30) }),
      async (a, c) => {
        await new Promise<void>((res, rej) => {
          const abort = () => {
            clearTimeout(t);
            rej(c.signal.reason);
          };
          const t = setTimeout(
            () => {
              c.signal.removeEventListener("abort", abort);
              res();
            },
            Number(a.seconds) * 1000,
          );
          c.signal.addEventListener("abort", abort, { once: true });
        });
        return "Selesai menunggu";
      },
    );
    add(
      "schedule",
      "Create persistent cron agent schedule (UTC).",
      z.object({ cron: s, prompt: s }),
      async (a, c) => {
        const { CronExpressionParser } = await import("cron-parser");
        CronExpressionParser.parse(String(a.cron));
        const id = randomUUID();
        this.store.run(
          "INSERT INTO schedules(id,cron,prompt,session_id) VALUES(?,?,?,?)",
          id,
          String(a.cron),
          String(a.prompt),
          c.session,
        );
        return { id, timezone: "UTC" };
      },
      true,
    );
    add(
      "makefun_fetch_bounty",
      "Fetch actual bounty URL or save pasted brief. Never invent API routes.",
      z.object({
        url: s.url().optional(),
        brief: s.optional(),
        title: s.default("Bounty make.fun"),
      }),
      async (a, c) => {
        let brief = String(a.brief ?? "");
        if (a.url) brief = await web(String(a.url), c);
        if (!brief.trim()) throw new Error("Masukkan URL atau brief");
        const id = randomUUID();
        this.store.run(
          "INSERT INTO bounties(id,title,url,brief,session_id) VALUES(?,?,?,?,?)",
          id,
          String(a.title),
          String(a.url ?? ""),
          brief,
          c.session,
        );
        return { id, brief };
      },
    );
    add(
      "makefun_plan",
      "Save concrete acceptance criteria and implementation plan.",
      z.object({ id: s, criteria: z.array(s).min(1), plan: s }),
      async (a) => {
        this.store.run(
          "UPDATE bounties SET criteria=?,result=?,status='dikerjakan' WHERE id=?",
          JSON.stringify(
            (a.criteria as string[]).map((text) => ({
              text,
              passed: false,
              evidence: "",
            })),
          ),
          String(a.plan),
          String(a.id),
        );
        return "Rencana dan checklist disimpan";
      },
    );
    add(
      "makefun_build",
      "Read bounty and mark implementation active. Use coding tools to produce real deliverable.",
      z.object({ id: s }),
      async (a) => {
        const b = this.store.get(
          "SELECT * FROM bounties WHERE id=?",
          String(a.id),
        );
        if (!b) throw new Error("Bounty tidak ditemukan");
        this.store.run(
          "UPDATE bounties SET status='dikerjakan' WHERE id=?",
          String(a.id),
        );
        return {
          bounty: b,
          instruction:
            "Implementasikan seluruh brief dengan write_file/bash. Setelah selesai jalankan makefun_verify dengan command test nyata.",
        };
      },
    );
    add(
      "makefun_verify",
      "Run real test command and store evidence per criterion. Failed tests never mark ready.",
      z.object({
        id: s,
        command: s,
        evidence: z.array(
          z.object({ text: s, passed: z.boolean(), evidence: s.min(1) }),
        ),
      }),
      async (a, c) => {
        const output = await shell({ command: a.command }, c);
        const evidence = a.evidence as { passed: boolean }[];
        const ok =
          output.startsWith("exit=0\n") &&
          evidence.length > 0 &&
          evidence.every((e) => e.passed);
        this.store.run(
          "UPDATE bounties SET status=?,criteria=?,result=? WHERE id=?",
          ok ? "dites" : "dikerjakan",
          JSON.stringify(a.evidence),
          output,
          String(a.id),
        );
        return { ok, output };
      },
    );
    add(
      "makefun_submit_pack",
      "Package tested deliverable with README. Does not submit externally.",
      z.object({ id: s, summary: s }),
      async (a, c) => {
        const b = this.store.get(
          "SELECT * FROM bounties WHERE id=?",
          String(a.id),
        );
        if (!b || b.status !== "dites")
          throw new Error("Bounty harus lulus verifikasi");
        const root = await this.sandbox.root(c.session);
        await fs.writeFile(
          await safePath(root, "SUBMISSION.md"),
          `# ${b.title}\n\n${a.summary}\n\n## Verifikasi\n${b.result}\n`,
        );
        const output = await shell(
          {
            command:
              "zip -r submission.zip . -x 'node_modules/*' '.git/*' 'submission.zip' '.env' '.env.*'",
          },
          c,
        );
        if (!output.startsWith("exit=0")) throw new Error(output);
        this.store.run(
          "UPDATE bounties SET status='siap submit',result=? WHERE id=?",
          String(a.summary),
          String(a.id),
        );
        return { path: "submission.zip", summary: a.summary };
      },
    );
  }
}

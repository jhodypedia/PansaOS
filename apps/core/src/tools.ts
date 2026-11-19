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
  redact,
} from "./security.js";
import { Store } from "./store.js";
import { Sandbox } from "./sandbox.js";
import { Skills } from "./skills.js";
import type { Definition } from "./providers.js";
import { SessionState, TodoSchema, enforceMode } from "./session-state.js";
import { applyEdits, previewDiff, Checkpoints } from "./workspace.js";
import { Profile } from "./profile.js";

const MAX_JSON_NODES = 400;
function compactJson(value: unknown, budget = { left: MAX_JSON_NODES }): unknown {
  if (budget.left <= 0) return "…";
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string")
    return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (Array.isArray(value)) {
    budget.left -= 1;
    if (value.length > 8) {
      const head = value.slice(0, 8).map((v) => compactJson(v, budget));
      return [...head, `… ${value.length - 8} item lagi`];
    }
    return value.map((v) => compactJson(v, budget));
  }
  if (typeof value === "object") {
    budget.left -= 1;
    const entries = Object.entries(value as Record<string, unknown>);
    const limited = entries.length > 40 ? entries.slice(0, 40) : entries;
    const out: Record<string, unknown> = {};
    for (const [k, v] of limited) out[k] = compactJson(v, budget);
    if (entries.length > limited.length)
      out["…"] = `${entries.length - limited.length} kunci lagi`;
    return out;
  }
  return String(value);
}
function fitJson(value: unknown, limit: number): string {
  let out = JSON.stringify(value) ?? "null";
  if (out.length <= limit) return out;
  let trimmed = value;
  for (let i = 0; i < 6 && out.length > limit; i++) {
    trimmed = compactJson(trimmed, { left: Math.max(20, MAX_JSON_NODES >> (i + 1)) });
    out = JSON.stringify(trimmed) ?? "null";
  }
  if (out.length <= limit) return out;
  return JSON.stringify({
    truncated: true,
    bytes: out.length,
    preview: out.slice(0, Math.max(0, limit - 200)),
  });
}

export interface ToolContext {
  session: string;
  signal: AbortSignal;
  depth: number;
  subtype?: "explore" | "plan" | "general";
}
export interface Tool {
  name: string;
  description: string;
  schema: z.ZodType;
  risky?: boolean;
  parameters?: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}
const s = z.string(),
  optionalPath = z.string().default(".");
const quote = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
export class Tools {
  backgroundTasks = new Map<string, { id: string; session: string; type: string; status: string; since: string; summary?: unknown }>();
  checkpoints: Checkpoints;
  profile: Profile;
  state: SessionState;
  registry = new Map<string, Tool>();
  pending = new Map<string, (ok: boolean) => void>();
  humanWait = new Map<string, { hold: () => void; release: () => void }>();
  questions = new Map<string, { session: string; question: string; options: string[]; answer: (answer: string) => void }>();
  spawnTask: (prompt: string, ctx: ToolContext, type?: "explore" | "plan" | "general") => Promise<unknown> =
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
    this.state = new SessionState(store);
    this.checkpoints = new Checkpoints(sandbox);
    this.profile = new Profile(store);
    this.builtins();
    for (const [alias, name] of [["replace_text", "edit_file"], ["rg_grep", "grep"], ["list_dir", "list_files"], ["shell", "bash"], ["sandbox_exec", "bash"]] as const) {
      const tool = this.registry.get(name)!;
      this.add({ ...tool, name: alias });
    }
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
          parameters: t.parameters ?? (zodToJsonSchema as unknown as (schema: unknown, options: unknown) => Record<string, unknown>)(t.schema, {
            target: "openApi3",
          }) as Record<string, unknown>,
        },
      }));
  }
  async runShell(
    session: string,
    command: string,
    ctx: ToolContext,
    timeout = 60000,
    fresh = false,
  ): Promise<string> {
    return this.sandbox.run(session, command, ctx.signal, timeout, fresh);
  }
  async approval(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    force = false,
  ) {
    if (
      !force && !name.includes("__") && !["git_commit", "checkpoint_restore", "execute_plan", "git_branch"].includes(name) && this.store.get(
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
    const wait = this.humanWait.get(ctx.session);
    wait?.hold();
    try {
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
    } finally {
      wait?.release();
    }
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
  answer(id: string, value: string) {
    const pending = this.questions.get(id);
    if (!pending) throw new Error("Pertanyaan sudah kedaluwarsa");
    if (!value.trim() || value.length > 4000) throw new Error("Jawaban tidak valid");
    pending.answer(value);
  }
  async call(name: string, input: unknown, ctx: ToolContext): Promise<string> {
    ctx.signal.throwIfAborted();
    const tool = this.registry.get(name);
    if (!tool || this.store.setting(`tool.${name}`, "true") === "false")
      throw new Error("Tool tidak tersedia");
    const args = tool.schema.parse(input) as Record<string, unknown>;
    if (["bash", "shell", "sandbox_exec", "run_node", "run_python"].includes(name) && /\bgit\b[^\n;]*\bcommit\b/.test(String(args.command ?? args.code))) throw new Error("Gunakan git_commit agar diff lengkap dan approval wajib ditampilkan");
    if (["bash", "shell", "sandbox_exec"].includes(name) && /\bgit\s+(?:[^;\n]*\s)?push\b/.test(String(args.command))) {
      const last = this.store.get("SELECT payload FROM messages WHERE session_id=? AND json_extract(payload,'$.role')='user' ORDER BY id DESC LIMIT 1", ctx.session);
      if (!last || !/\bpush\b/i.test(String(JSON.parse(String(last.payload)).content))) throw new Error("git push membutuhkan perintah eksplisit owner");
    }
    const mode = this.state.mode(ctx.session);
    enforceMode(mode, name, ctx.subtype);
    if (["write_file", "edit_file", "replace_text", "multi_edit"].includes(name)) {
      const changed = this.state.get<string[]>(ctx.session, "changed_files", []);
      if (changed.length === 2 && !changed.includes(String(args.path))) {
        const checkpoint = await this.checkpoints.create(ctx.session, "Sebelum perubahan multi-file berikutnya");
        this.store.event("progress", ctx.session, { text: `Checkpoint: ${checkpoint.name}`, checkpoint });
      }
    }
    const commandText = String(args.command ?? (["git", "npm", "lint_test"].includes(name) ? (args.args as string[] | undefined)?.join(" ") : ""));
    if ((name === "git" || ["bash", "shell", "sandbox_exec"].includes(name)) && /\bgit\b[^\n;]*\bcommit\b/.test(commandText)) throw new Error("Gunakan git_commit agar diff lengkap dan approval wajib ditampilkan");
    if ((name === "git" || name === "bash" || name === "shell" || name === "sandbox_exec") && /\bgit\s+(?:[^;\n]*\s)?push\b/.test(commandText)) {
      const last = this.store.get("SELECT payload FROM messages WHERE session_id=? AND json_extract(payload,'$.role')='user' ORDER BY id DESC LIMIT 1", ctx.session);
      if (!last || !/\bpush\b/i.test(String(JSON.parse(String(last.payload)).content))) throw new Error("git push membutuhkan perintah eksplisit owner");
    }
    const destructive = /\brm\s+[^\n]*(?:-rf|-fr)|\bgit\s+(?:push|commit|reset\s+--hard)\b/i.test(commandText);
    const needsApproval = (mode === "ask" && !["ask_question", "todo_read", "todo_write"].includes(name)) || ["write_file", "edit_file", "replace_text", "multi_edit", "bash", "shell", "sandbox_exec", "run_node", "run_python", "lint_test", "unzip", "zip", "git", "npm", "download_file"].includes(name) || (name === "http_request" && String(args.method ?? "GET") !== "GET") || destructive;
    if (needsApproval) await this.approval(name, args, ctx, destructive || (name === "http_request" && String(args.method ?? "GET") !== "GET"));
    if (
      tool.risky ||
      /rm\s+.*-[a-z]*r|\b(sendTransaction|transfer|payment|withdraw)\b/i.test(
        JSON.stringify(args),
      )
    )
      if (!needsApproval) await this.approval(name, args, ctx, Boolean(tool.risky) || ["telegram_send", "notify"].includes(name));
    const command =
      typeof args.command === "string" ? args.command.slice(0, 300) : undefined;
    const file = typeof args.path === "string" ? args.path.slice(0, 300) : undefined;
    const lines =
      typeof args.content === "string"
        ? args.content.split("\n").length
        : typeof args.replacement === "string"
          ? args.replacement.split("\n").length
          : undefined;
    this.store.event("tool", ctx.session, {
      tool: name,
      name,
      args,
      command,
      content: command ?? (file ? `${name} ${file}` : name),
      file,
      lines,
      status: "running",
    });
    const started = Date.now();
    const ticker = setInterval(
      () =>
        this.store.event("tool", ctx.session, {
          tool: name,
          name,
          args,
          command,
          content: command ?? (file ? `${name} ${file}` : name),
          file,
          lines,
          status: "running",
          durationMs: Date.now() - started,
          output: `masih berjalan ${Math.round((Date.now() - started) / 1000)} dtk`,
        }),
      10000,
    );
    ticker.unref?.();
    try {
      const result = await tool.run(args, ctx);
      const raw = redact(
        typeof result === "string"
          ? result
          : fitJson(result, config.TOOL_OUTPUT_LIMIT), this.store.secrets);
      const output =
        raw.slice(0, config.TOOL_OUTPUT_LIMIT) +
        (raw.length > config.TOOL_OUTPUT_LIMIT ? "\n[output dipotong]" : "");
      const exitCode =
        name === "bash" || command
          ? Number(/^exit=(-?\d+)/.exec(raw)?.[1] ?? 0)
          : undefined;
      this.store.event("tool", ctx.session, {
        tool: name,
        name,
        args,
        command,
        content: command ?? (file ? `${name} ${file}` : name),
        file,
        lines,
        status: exitCode === 0 || exitCode === undefined ? "done" : "error",
        exitCode,
        durationMs: Date.now() - started,
        output: output.slice(0, config.TOOL_OUTPUT_LIMIT),
        tail: raw
          .replace(/^exit=-?\d+\n?/, "")
          .trim()
          .slice(-400),
      });
      clearInterval(ticker);
      return output;
    } catch (e) {
      clearInterval(ticker);
      const error = e instanceof Error ? e.message : "Tool gagal";
      this.store.event("tool", ctx.session, {
        tool: name,
        name,
        args,
        command,
        content: command ?? (file ? `${name} ${file}` : name),
        file,
        lines,
        status: "error",
        durationMs: Date.now() - started,
        output: error,
        error,
      });
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
    add("todo_read", "Read persistent session todos.", z.object({}), async (_a, c) => this.state.todos(c.session));
    add("todo_write", "Update todos for work with 3+ steps; at most one in_progress.", z.object({ items: TodoSchema }), async (a, c) => {
      const items = TodoSchema.parse(a.items);
      const previous = this.state.todos(c.session);
      this.state.set(c.session, "todos", items);
      this.store.event("progress", c.session, { kind: "todo", items, text: items.filter((item, i) => item.status !== previous[i]?.status || item.content !== previous[i]?.content).map(item => `${item.status}: ${item.content}`).join(" · ") });
      return items;
    });
    add("ask_question", "Ask a material decision with 2–4 choices. Wait up to five minutes; use declared default or stop.", z.object({ question: s.min(1).max(300), options: z.array(z.object({ label: s.min(1).max(60), description: s.max(180) })).min(2).max(4), allow_free: z.boolean().default(true), default: s.optional() }), async (a, c) => {
      const id = randomUUID(), options = a.options as { label: string; description: string }[];
      if (a.default && !options.some(o => o.label === a.default)) throw new Error("Default harus salah satu pilihan");
      const wait = this.humanWait.get(c.session);
      wait?.hold();
      const answer = await new Promise<string>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); this.questions.delete(id); c.signal.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); reject(new Error("Pertanyaan dibatalkan")); };
        const timer = setTimeout(() => { cleanup(); a.default ? resolve(String(a.default)) : reject(new Error("Tidak ada jawaban dalam 5 menit; task dihentikan")); }, 300000);
        this.questions.set(id, { session: c.session, question: String(a.question), options: options.map(o => o.label), answer: value => {
          if (!a.allow_free && !options.some(o => o.label === value)) throw new Error("Pilih jawaban yang tersedia");
          cleanup(); resolve(value);
        } });
        c.signal.addEventListener("abort", abort, { once: true });
        this.store.event("progress", c.session, { kind: "question", id, question: a.question, options, allow_free: a.allow_free, default: a.default, text: a.question });
      }).finally(() => wait?.release());
      this.store.remember(String(a.question), answer, "decision", c.session);
      this.store.event("progress", c.session, { kind: "answer", id, text: `Keputusan owner: ${answer}` });
      return { question: a.question, answer, source: "owner_or_declared_timeout_default" };
    });
    const normalize = (p: string) => {
      const bare = p.trim();
      if (config.EXEC_MODE !== "docker" || !/^\/?workspace(?:\/|$)/.test(bare)) return bare;
      const stripped = bare.replace(/^\/?workspace(?:\/|$)/, "");
      return stripped || ".";
    };
    const resolve = async (c: ToolContext, p: unknown) =>
      safePath(await this.sandbox.root(c.session), normalize(String(p)));
    const format = async (c: ToolContext, input: string) => {
      const rel = normalize(input), file = await resolve(c, rel);
      if (config.EXEC_MODE === "docker" && process.getuid?.() === 0) {
        await fs.chown(file, 1000, 1000);
        const root = await this.sandbox.root(c.session);
        let dir = path.dirname(file);
        while (dir !== root && dir.startsWith(root + path.sep)) { await fs.chown(dir, 1000, 1000); dir = path.dirname(dir); }
      }
      const before = await fs.readFile(file, "utf8");
      const extension = path.extname(rel);
      const formatter = /\.(tsx?|jsx?|json|css|md)$/.test(extension)
        ? `[ -x node_modules/.bin/prettier ] && node_modules/.bin/prettier --write -- ${quote(rel)}`
        : extension === ".py" ? `command -v ruff >/dev/null && ruff format -- ${quote(rel)}`
        : extension === ".go" ? `command -v gofmt >/dev/null && gofmt -w -- ${quote(rel)}` : "";
      if (formatter) await this.sandbox.run(c.session, config.EXEC_MODE === "host" ? formatter : `cd /workspace; ${formatter}`, c.signal, 30000, true).catch(() => {});
      const after = await fs.readFile(file, "utf8");
      const changed = this.state.get<string[]>(c.session, "changed_files", []);
      this.state.set(c.session, "changed_files", [...new Set([...changed, rel])]);
      return { after, formatted: before !== after };
    };
    const shell = async (a: Record<string, unknown>, c: ToolContext) =>
      this.runShell(
        c.session,
        String(a.command),
        c,
        Number(a.timeout ?? 60000),
        Boolean(a.fresh),
      );
    add(
      "bash",
      `Run shell in the active project directory using ${config.EXEC_MODE} execution. Working directory persists in this session.`,
      z.object({
        command: s,
        timeout: z.number().min(100).max(300000).default(60000),
        fresh: z.boolean().default(false),
      }),
      shell,
    );
    const pathRule =
      "Path relatif terhadap direktori proyek aktif (contoh: notes.txt, src/index.ts).";
    add(
      "read_file",
      `Read UTF-8 workspace file. ${pathRule}`,
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
      `Write a UTF-8 workspace file. ${pathRule}`,
      z.object({ path: s, content: s }),
      async (a, c) => {
        const file = await resolve(c, a.path);
        const before = await fs.readFile(file, "utf8").catch(() => "");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, String(a.content));
        const result = await format(c, String(a.path));
        return { file: a.path, diff: previewDiff(String(a.path), before, result.after), formatted: result.formatted };
      },
    );
    add(
      "edit_file",
      `Replace one exact text occurrence. Reject ambiguous matches. ${pathRule}`,
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
        const result = await format(c, String(a.path));
        return { file: a.path, diff: previewDiff(String(a.path), raw, result.after), formatted: result.formatted };
      },
    );
    add("multi_edit", "Apply exact replacements atomically in one file.", z.object({ path: s, edits: z.array(z.object({ old: s.min(1), replacement: s })).min(1) }), async (a, c) => {
      const file = await resolve(c, a.path), before = await fs.readFile(file, "utf8");
      const after = applyEdits(before, a.edits as { old: string; replacement: string }[]);
      const temp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, after);
      await fs.rename(temp, file);
      const result = await format(c, String(a.path));
      return { file: a.path, diff: previewDiff(String(a.path), before, result.after), formatted: result.formatted };
    });
    add("checkpoint_create", "Snapshot workspace outside the workspace.", z.object({ name: s }), async (a, c) => this.checkpoints.create(c.session, String(a.name)));
    add("checkpoint_list", "List workspace checkpoints.", z.object({}), async (_a, c) => this.checkpoints.list(c.session));
    add("checkpoint_changes", "List files changed since a checkpoint with status and hashes.", z.object({ id: s.optional() }), async (a, c) => {
      const id = String(a.id ?? (await this.checkpoints.list(c.session))[0]?.id ?? "");
      if (!id) throw new Error("Belum ada checkpoint di session ini");
      return this.checkpoints.changes(c.session, id);
    });
    add("checkpoint_restore", "Restore checkpoint after approval of all changed files.", z.object({ id: s }), async (a, c) => {
      const changes = await this.checkpoints.changes(c.session, String(a.id));
      if (changes.changed.length) await this.approval("checkpoint_restore", { checkpoint: changes.manifest.name, files: changes.changed }, c);
      return this.checkpoints.restore(c.session, String(a.id));
    });
    for (const [name, command] of [["git_status", "git rev-parse --git-dir >/dev/null 2>&1 || { echo 'not a git repository'; exit 0; }; git status --short --branch"], ["git_diff", "git rev-parse --git-dir >/dev/null 2>&1 || { echo 'not a git repository'; exit 0; }; git diff HEAD -- .; git diff --cached -- ."], ["git_log", "git rev-parse --git-dir >/dev/null 2>&1 || { echo 'not a git repository'; exit 0; }; git log --oneline -12"]] as const)
      add(name, `Read ${name} in workspace.`, z.object({}), async (_a, c) => shell({ command, fresh: false }, c));
    add("git_branch", "List or switch branches with approval.", z.object({ branch: s.optional() }), async (a, c) => {
      if (!a.branch) return shell({ command: "git branch --list", fresh: false }, c);
      await this.approval("git_branch", a, c);
      return shell({ command: `git switch -- ${quote(String(a.branch))}`, fresh: false }, c);
    });
    add("git_commit", "Show full staged diff and proposed commit message, then wait for approval. Never pushes.", z.object({ message: s.min(1) }), async (a, c) => {
      const names = await shell({ command: "git diff --cached --name-only", fresh: false }, c);
      if (/(^|\/)(\.env(?:\.[^/]*)?|[^/]*(?:private[_.-]?key|token|credentials)[^/]*|[^/]+\.pem)$/im.test(names)) throw new Error("Commit file secret ditolak");
      const diff = await shell({ command: "git diff --cached --no-ext-diff", fresh: false }, c);
      if (diff.includes("[output dipotong]")) throw new Error("Diff terlalu besar; commit ditolak sampai diff lengkap bisa ditampilkan");
      if (/-----BEGIN .*PRIVATE KEY|(?:sk-|gsk_|af_)[A-Za-z0-9_-]{12,}|(?:api[_-]?key|token|password)\s*[:=]\s*["'][^"']{12,}/i.test(diff)) throw new Error("Diff mengandung pola secret; commit ditolak");
      await this.approval("git_commit", { message: a.message, diff }, c);
      return shell({ command: `git commit -m ${quote(String(a.message))}`, fresh: false }, c);
    });
    add("file_info", "Read file size and timestamps.", z.object({ path: s }), async (a, c) => {
      const st = await fs.stat(await resolve(c, a.path)); return { size: st.size, modified: st.mtime.toISOString(), directory: st.isDirectory() };
    });
    for (const name of ["symbol_search", "file_outline"])
      add(name, "Find function/class/type definitions using Universal Ctags in sandbox.", z.object({ name: s.optional(), path: s.default(".") }), async (a, c) => {
        await resolve(c, a.path);
        const rel = config.EXEC_MODE === "docker" ? String(a.path).replace(/^\/?workspace\/?/, "") || "." : String(a.path);
        const output = await shell({ command: `ctags --output-format=json --fields=+n -R -f - ${quote(`./${rel}`)}`, fresh: false }, c);
        if (!output.startsWith("exit=0")) throw new Error(output);
        return output.split("\n").filter(line => { try { const row = JSON.parse(line); return !a.name || String(row.name).includes(String(a.name)); } catch { return false; } }).join("\n");
      });
    add(
      "list_files",
      `List workspace directory. ${pathRule}`,
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
      `Delete workspace path after approval. ${pathRule}`,
      z.object({ path: s }),
      async (a, c) => {
        const p = await resolve(c, a.path);
        if (p === (await this.sandbox.root(c.session)))
          throw new Error("Root workspace tidak boleh dihapus");
        await fs.rm(p, { recursive: true });
        return "Dihapus";
      },
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
      `Create submission ZIP from workspace paths. ${pathRule}`,
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
      `Extract archive in sandbox; review untrusted archive first. ${pathRule}`,
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
      "HTTP request to public URL. Mutating methods require approval. Returns status plus the body: JSON responses come back as structured objects, other bodies as text.",
      z.object({
        url: s.url(),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .default("GET"),
        headers: z.record(s).default({}),
        body: s.optional(),
      }),
      async (a, c) => {
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
        const text = redact(
          (await limitedBody(r)).toString(),
          this.store.secrets,
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {}
        return parsed !== undefined
          ? { status: r.status, json: compactJson(parsed) }
          : { status: r.status, body: text.slice(0, config.TOOL_OUTPUT_LIMIT) };
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
        kind: z.enum(["fact", "note", "episodic", "preference", "decision", "commitment", "relationship"]).default("fact"),
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
      async (a, c) => this.store.recall(String(a.query), c.session),
    );
    add(
      "forget",
      "Delete memory after approval.",
      z.object({ query: s }),
      async (a, c) => this.profile.forgetMemory(String(a.query), c.session),
      true,
    );
    add("memory_save", "Simpan fakta tahan lama lintas kanal dengan kategori dan asal percakapan.", z.object({ key: s.min(1).max(300), content: s.min(1).max(8000), category: z.enum(["fakta", "preferensi", "keputusan", "komitmen", "hubungan"]) }), async (a, c) => this.profile.saveMemory(String(a.category), String(a.key), String(a.content), c.session));
    add("memory_forget", "Hapus memori yang cocok di profil global dan sesi ini, lalu verifikasi dokumen serta indeks.", z.object({ query: s.min(1).max(500) }), async (a, c) => this.profile.forgetMemory(String(a.query), c.session));
    add("memory_explain", "Tampilkan kapan dan dari percakapan mana memori dipelajari.", z.object({ query: s }), async (a, c) => this.store.all("SELECT id,key,content,kind,category,source_type,source_session,created_at FROM memory WHERE (key LIKE ? OR content LIKE ?) AND (session_id IS NULL OR session_id=?) ORDER BY created_at DESC LIMIT 20", `%${String(a.query)}%`, `%${String(a.query)}%`, c.session));
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
      z.object({ prompt: s, type: z.enum(["explore", "plan", "general"]).default("general"), background: z.boolean().default(false) }),
      async (a, c) => {
        if (c.depth > 0 && a.type !== "explore") throw new Error("Subagent hanya boleh membuat subagent explore");
        if (a.background) {
          const id = randomUUID();
          const task = { id, session: c.session, type: String(a.type), status: "running", since: new Date().toISOString(), summary: undefined as unknown };
          this.backgroundTasks.set(id, task);
          void this.spawnTask(String(a.prompt), c, a.type as "explore" | "plan" | "general").then(result => { task.status = "done"; task.summary = result; }).catch(error => { task.status = "error"; task.summary = String(error); });
          return { task: id, status: "running", instruction: "Gunakan task_status untuk mengambil ringkasan; owner mendapat notifikasi saat selesai." };
        }
        return this.spawnTask(String(a.prompt), c, a.type as "explore" | "plan" | "general");
      },
    );
    add("task_status", "Read a background subagent's status and summary.", z.object({ id: s }), async (a, c) => {
      const task = this.backgroundTasks.get(String(a.id));
      if (!task || task.session !== c.session) throw new Error("Task tidak ditemukan");
      return task;
    });
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
  }
}

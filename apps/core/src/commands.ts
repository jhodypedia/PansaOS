import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import type { Agent } from "./agent.js";
import { safePath, redact } from "./security.js";

export class Commands {
  constructor(public agent: Agent) {}
  async list() {
    const roots = [path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../commands"), path.resolve(config.skills, "../commands")];
    const rows = new Map<string, { name: string; description: string; instruction: string }>();
    for (const root of new Set(roots)) {
      const names = await fs.readdir(root).catch(() => [] as string[]);
      for (const file of names.filter(n => /^[a-z][a-z0-9_-]*\.md$/.test(n))) {
        const parsed = matter(await fs.readFile(path.join(root, file), "utf8"));
        const name = file.slice(0, -3);
        rows.set(name, { name, description: String(parsed.data.description ?? ""), instruction: parsed.content });
      }
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async execute(session: string, prompt: string): Promise<{ response?: string; prompt?: string; noExecute?: boolean } | null> {
    if (!prompt.startsWith("/")) return null;
    const [, name, rest = ""] = prompt.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/) ?? [];
    const commands = await this.list(), command = commands.find(c => c.name === name);
    if (!command) return { response: `Unknown command. Use /help.` };
    const { store, tools, providers } = this.agent;
    if (name === "help") return { response: commands.map(c => `/${c.name} — ${c.description}`).join("\n") };
    if (name === "permissions" && !["plan", "build", "ask"].includes(rest.toLowerCase())) {
      if (rest && rest !== "reset") return { response: "Use /permissions to view permissions or /permissions reset to revoke session permissions." };
      if (rest === "reset") { tools.revokePermissions(session); return { response: "Session permissions and auto-approve revoked. The next execution will request permission again." }; }
      return { response: `Mode: ${tools.state.mode(session)}\nActive session permissions: ${JSON.stringify(tools.permissions(session))}\nBuild: workspace editing is allowed; execution requires one-time or session permission. Ask: each action requires approval.\n/permissions reset — revoke session permissions and auto-approve. Session permissions are cleared when core restarts.` };
    }
    if (name === "mode" || name === "permissions") {
      if (rest && !["plan", "build", "ask"].includes(rest.toLowerCase())) return { response: "Choose /mode plan, /mode build, or /mode ask." };
      if (rest) tools.state.set(session, "mode", rest.toLowerCase());
      return { response: `Mode: ${tools.state.mode(session)}. Plan is read only; Build allows workspace edits and requests execution permission; Ask requests approval for each action.` };
    }
    if (name === "plan") { tools.state.set(session, "mode", "plan"); return { prompt: `Create a plan with steps, relevant files, risks, and completion criteria. Read only. ${rest}`, noExecute: true }; }
    if (name === "clear") {
      const last = store.get("SELECT MAX(id) id FROM messages WHERE session_id=?", session);
      tools.state.set(session, "history_after", Number(last?.id ?? 0));
      tools.state.set(session, "visible_after", Number(store.get("SELECT MAX(id) id FROM events WHERE session_id=?", session)?.id ?? 0));
      return { response: "The active view and context have been cleared. History remains in the session archive." };
    }
    if (name === "compact") {
      tools.state.set(session, "compact_requested", true);
      return { response: "Context cleanup queued for the next model request. Your task and saved history are preserved." };
    }
    if (name === "model") {
      const list = providers.list();
      if (rest) {
        const selected = providers.selectForSession(session, rest.toLowerCase() === "auto" ? null : rest);
        return { response: selected.pinned ? `Preferred for the next task: ${selected.provider} · ${selected.model}. Automatic failover is available.` : "Automatic model selection enabled for this session." };
      }
      return { response: list.map(p => `${p.id} · ${p.name} / ${p.model}${String(store.get("SELECT pinned FROM sessions WHERE id=?", session)?.pinned) === p.id ? " · active" : ""}`).join("\n") || "No providers yet. Add a connection in Providers." };
    }
    if (name === "cost") return { response: JSON.stringify(this.agent.sessionUsage(session), null, 2) };
    if (name === "doctor") {
      const shell = await tools.sandbox.run(session, "printf 'host shell OK\\n'; pwd", AbortSignal.timeout(20000), 20000, true).catch(e => `Execution failed: ${e.message}`);
      const health = await Promise.all(providers.list().filter(p => p.enabled).map(async p => {
        try {
          await providers.test(String(p.id));
          return `${p.name}/${p.model}: healthy`;
        } catch (error) { return `${p.name}/${p.model}: failed (${redact(error instanceof Error ? error.message : "connection failed", store.secrets)})`; }
      }));
      return { response: `Execution mode: ${config.EXEC_MODE}\nActive directory: ${config.workspace}\nProviders: ${health.join("\n") || "none"}\n${shell}` };
    }
    if (name === "init") {
      const checkpoint = await tools.checkpoints.create(session, "Before /init");
      store.event("progress", session, { text: `Checkpoint: ${checkpoint.name}`, checkpoint });
      return { prompt: `${command.instruction}\n${rest}` };
    }
    if (name === "review") return { prompt: `${command.instruction}\nLatest checkpoint: ${JSON.stringify((await tools.checkpoints.list(session))[0] ?? null)}\n${rest}`, noExecute: true };
    return { prompt: `${command.instruction}\nUser arguments: ${rest}` };
  }
  async mentions(session: string, prompt: string) {
    const names = [...prompt.matchAll(/(?:^|\s)@([\w./-]+)/g)].map(m => m[1]!).slice(0, 8);
    const root = await this.agent.tools.sandbox.root(session), attached = [];
    for (const name of names) {
      const file = await safePath(root, name);
      const st = await fs.stat(file);
      if (!st.isFile() || st.size > 100000) throw new Error(`Attachment is too large or is not a file: ${name}`);
      attached.push({ path: name, content: await fs.readFile(file, "utf8") });
    }
    return attached;
  }
}

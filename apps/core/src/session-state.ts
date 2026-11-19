import { z } from "zod";
import type { Store } from "./store.js";

export const TodoSchema = z.array(z.object({
  content: z.string().min(1).max(500),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
})).max(100).refine(items => items.filter(i => i.status === "in_progress").length <= 1,
  "Only one todo may be in_progress");
export type Mode = "plan" | "build" | "ask";
export class SessionState {
  constructor(public store: Store) {}
  get<T>(session: string, key: string, fallback: T): T {
    try { return JSON.parse(this.store.setting(`session:${session}:${key}`)) as T; }
    catch { return fallback; }
  }
  set(session: string, key: string, value: unknown) {
    this.store.set(`session:${session}:${key}`, JSON.stringify(value));
  }
  mode(session: string): Mode { return this.get<Mode>(session, "mode", "build"); }
  todos(session: string) { return this.get<z.infer<typeof TodoSchema>>(session, "todos", []); }
}

export const READ_TOOLS = new Set([
  "read_file", "list_files", "list_dir", "file_info", "glob", "grep", "rg_grep",
  "symbol_search", "file_outline", "read_skill", "read_memory", "todo_read",
  "git_status", "git_diff", "git_log", "checkpoint_list", "checkpoint_changes",
]);

export function enforceMode(mode: Mode, name: string, subtype?: string) {
  if (subtype === "explore" && !["read_file", "glob", "grep", "rg_grep", "list_files", "list_dir", "file_info"].includes(name))
    throw new Error("Plan mode: read only (Explore can only read the codebase)");
  if ((mode === "plan" || subtype === "explore" || subtype === "plan") && !READ_TOOLS.has(name))
    throw new Error("Plan mode: read only");
}

export const COMPACTION_SECTIONS = ["Goal and status", "User decisions", "Files and current state", "Pending work", "Unverified"];
export function structuredCompaction(parts: string[]) {
  return COMPACTION_SECTIONS.map((name, i) => `## ${name}\n${parts[i] || "Not recorded yet"}`).join("\n\n");
}

export type PermissionScope = "execution" | "workspace-write";
export interface PermissionRule {
  scope?: PermissionScope;
  label: string;
  alwaysAsk: boolean;
}

const executions = new Set(["bash", "shell", "sandbox_exec", "run_node", "run_python", "npm", "lint_test", "git"]);
const writes = new Set(["write_file", "edit_file", "replace_text", "multi_edit", "download_file", "zip"]);
const special = new Set(["git_commit", "checkpoint_restore", "execute_plan", "delete_file", "unzip", "telegram_send", "notify"]);

export function permissionRule(name: string, args: Record<string, unknown>, risky = false, force = false): PermissionRule | null {
  const method = String(args.method ?? "GET").toUpperCase();
  if (force || risky || name.includes("__") || special.has(name) || (name === "browser" && Boolean(args.click || args.text)) || (name === "git_branch" && Boolean(args.branch)) || (name === "http_request" && !["GET", "HEAD", "OPTIONS"].includes(method)))
    return { label: "One-time approval for this protected action", alwaysAsk: true };
  if (executions.has(name)) {
    const command = name === "git" ? `git ${(args.args as string[] ?? []).join(" ")}` : String(args.command ?? args.code ?? "");
    // These checks make obvious high-impact commands ask again. They are not a shell sandbox.
    if (/\b(?:sudo|su|doas|systemctl|service|reboot|shutdown|mkfs|mount|umount|chown|chmod)\b|\brm\b|\bgit\b[^\n;]*(?:\bpush\b|\bcommit\b|\breset\b|\bclean\b)|\b(?:transfer|payment|withdraw|sendTransaction)\b|(?:\/etc\/|\/usr\/|\/boot\/|\/root\/)/i.test(command))
      return { label: "High-impact command · one-time approval", alwaysAsk: true };
    // Only exact simple commands; pipelines, substitutions, arbitrary flags and scripts require execution permission.
    if ((["bash", "shell", "sandbox_exec"].includes(name) && /^(?:pwd|ls(?: -[alh]+)?|git status(?: --short)?|git log --oneline(?: -\d+)?|git diff --stat)\s*$/.test(command)) ||
        (name === "git" && /^(?:git status(?: --short)?|git log --oneline(?: -\d+)?|git diff --stat)\s*$/.test(command))) return null;
    return { scope: "execution", label: "Shell, Python, Node, and project command execution", alwaysAsk: false };
  }
  if (writes.has(name)) return { scope: "workspace-write", label: "File changes in the workspace", alwaysAsk: false };
  return null;
}

export const executionNotice = "Execution permission covers shell, Python, Node, and project commands in this session. Code runs with the Pansa account's privileges; this permission does not isolate filesystem or network access.";

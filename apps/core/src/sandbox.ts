import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "./config.js";

export function execute(
  command: string,
  args: string[],
  signal: AbortSignal,
  cwd?: string,
  home?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(command, args, {
      cwd,
      env: { PATH: process.env.PATH, HOME: home ?? (config.EXEC_MODE === "host" ? (process.env.HOME ?? os.homedir()) : "/tmp"), LANG: "C.UTF-8" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (b: Buffer) => {
      if (output.length < config.TOOL_OUTPUT_LIMIT) output += b.toString();
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const abort = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else
        resolve(
          `exit=${code}\n${output.slice(0, config.TOOL_OUTPUT_LIMIT)}${output.length >= config.TOOL_OUTPUT_LIMIT ? "\n[output dipotong]" : ""}`,
        );
    });
  });
}
export class Sandbox {
  private queues = new Map<string, Promise<unknown>>();
  private sessionRoots = new Map<string, string>();
  setRoot(session: string, root: string) {
    if (!/^[a-f0-9-]{36}$/.test(session)) throw new Error("Session ID invalid");
    this.sessionRoots.set(session, path.resolve(root));
  }
  async home(session: string) {
    await this.root(session);
    const home = path.join(config.state, "sessions", session, "home");
    await fs.mkdir(home, { recursive: true });
    if (config.EXEC_MODE === "docker" && process.getuid?.() === 0) await fs.chown(home, 1000, 1000);
    return home;
  }
  async persistent(session: string, command: string, signal: AbortSignal, timeout: number) {
    const prior = this.queues.get(session) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(() => this.execPersistent(session, command, signal, timeout));
    this.queues.set(session, next);
    try { return await next; } finally { if (this.queues.get(session) === next) this.queues.delete(session); }
  }
  private async execPersistent(session: string, command: string, signal: AbortSignal, timeout: number) {
    await this.root(session);
    const home = await this.home(session);
    if (config.EXEC_MODE === "host") {
      const stateFile = path.join(config.state, "sessions", session, "shell.json");
      const saved: { cwd?: string } = await fs.readFile(stateFile, "utf8").then((text) => JSON.parse(text) as { cwd?: string }).catch(() => ({} as { cwd?: string }));
      const root = await this.root(session);
      const cwd = saved.cwd && (saved.cwd === root || saved.cwd.startsWith(root + path.sep)) ? saved.cwd : root;
      const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
      const result = await execute("bash", ["-c", `cd ${quote(cwd)} || exit; { ${command}; }; status=$?; pwd > ${quote(path.join(home, ".cwd.tmp"))}; exit $status`], AbortSignal.any([signal, AbortSignal.timeout(timeout)]), root, home);
      const nextCwd = await fs.readFile(path.join(home, ".cwd.tmp"), "utf8").catch(() => root);
      await fs.rm(path.join(home, ".cwd.tmp"), { force: true });
      const resolvedCwd = nextCwd.trim();
      if (resolvedCwd === root || resolvedCwd.startsWith(root + path.sep)) await fs.writeFile(stateFile, JSON.stringify({ cwd: resolvedCwd }));
      return result;
    }
    const name = `pansa-shell-${session}`;
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const inspected = await execute("docker", ["inspect", "-f", "{{.State.Running}}", name], combined);
    let reset = false;
    if (!inspected.includes("\ntrue")) {
      const existed = inspected.startsWith("exit=0");
      reset = existed || await fs.stat(path.join(home, ".shell-started")).then(() => true).catch(() => false);
      if (existed) await execute("docker", ["rm", "-f", name], combined);
      const hostBase = config.HOST_WORKSPACE_DIR ?? config.workspace;
      const hostRoot = path.join(hostBase, session);
      const daemon = `mkdir -p /tmp/pansa-shell; mkfifo /tmp/pansa-shell/requests; exec 3<>/tmp/pansa-shell/requests; set -o history; HISTFILE=/home/agent/.bash_history; history -r; while IFS= read -r request <&3; do { source "$request"; } >"$request.out" 2>&1; result=$?; printf '%s\\n%s\\n' "$result" "$PWD" >"$request.status"; history -w; done`;
       const started = await execute("docker", ["run", "-d", "--name", name, "--label", `pansa.session=${session}`, "--init", "--cpus", "2", "--memory", "2g", "--pids-limit", "512", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,size=1g", "--network", config.SANDBOX_NETWORK === "true" ? "bridge" : "none", "--user", "1000:1000", "-v", `${hostRoot}:/workspace`, "-v", `${path.join(config.state, "sessions", session, "home")}:/home/agent`, "-w", "/workspace", "-e", "HOME=/home/agent", "-e", "PATH=/home/agent/.local/bin:/workspace/.local/bin:/workspace/.tools:/usr/local/bin:/usr/bin:/bin", config.SANDBOX_IMAGE, "bash", "-c", daemon], combined);
      if (!started.startsWith("exit=0")) throw new Error(started);
      await fs.writeFile(path.join(home, ".shell-started"), new Date().toISOString());
    }
    const id = crypto.randomUUID();
    const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const script = `request=/tmp/pansa-shell/${id}; printf '%s\\n' ${q(`history -s -- ${q(command)}\n${command}`)} >"$request"; while [ ! -p /tmp/pansa-shell/requests ]; do sleep 0.05; done; printf '%s\\n' "$request" >/tmp/pansa-shell/requests; while [ ! -f "$request.status" ]; do sleep 0.05; done; read -r code <"$request.status"; printf 'exit=%s\\n' "$code"; tail -n 1 "$request.status" | sed 's/^/cwd=/'; cat "$request.out"; rm -f "$request" "$request.out" "$request.status"`;
    try {
      const result = await execute("docker", ["exec", name, "bash", "-c", script], combined);
      const cwd = result.match(/^cwd=(.*)$/m)?.[1];
      if (cwd) await fs.writeFile(path.join(home, "shell-state.json"), JSON.stringify({ cwd, updated: new Date().toISOString() }));
      return `${result.replace(/^exit=0\n/, "")}${reset ? "\nState shell ter-reset karena container sebelumnya berhenti." : ""}`;
    } catch (e) {
      await this.kill(session);
      throw e;
    }
  }
  async kill(session: string): Promise<number> {
    if (!/^[a-f0-9-]{36}$/.test(session)) return 0;
    if (config.EXEC_MODE === "host") return 0;
    try {
      const listed = await execute(
        "docker",
        [
          "ps",
          "-aq",
          "--filter",
          `label=pansa.session=${session}`,
        ],
        AbortSignal.timeout(10000),
      );
      const ids = listed
        .replace(/^exit=-?\d+\n?/, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[0-9a-f]{12,64}$/.test(line));
      for (const id of ids)
        await execute("docker", ["rm", "-f", id], AbortSignal.timeout(15000));
      return ids.length;
    } catch {
      return 0;
    }
  }
  async root(session: string) {
    if (!/^[a-f0-9-]{36}$/.test(session)) throw new Error("Session ID invalid");
    const root = config.EXEC_MODE === "host" ? (this.sessionRoots.get(session) ?? config.workspace) : path.join(config.workspace, session);
    await fs.mkdir(root, { recursive: true });
    if (config.EXEC_MODE === "docker" && process.getuid?.() === 0) await fs.chown(root, 1000, 1000);
    return root;
  }
  async run(
    session: string,
    command: string,
    signal: AbortSignal,
    timeout = 60000,
    fresh = false,
  ): Promise<string> {
    if (!fresh) return this.persistent(session, command, signal, timeout);
    const root = await this.root(session),
      combined = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.min(timeout, 300000)),
      ]);
    if (config.EXEC_MODE === "host" || config.ALLOW_UNSANDBOXED === "true")
      return execute("bash", ["-c", command], combined, root, await this.home(session));
    const name = `pansa-${session}-${crypto.randomUUID().slice(0, 8)}`;
    const hostRoot = path.join(config.HOST_WORKSPACE_DIR ?? config.workspace, session);
    const cleanup = () => {
      void execute(
        "docker",
        ["rm", "-f", name],
        AbortSignal.timeout(10000),
      ).catch(() => {});
    };
    combined.addEventListener("abort", cleanup, { once: true });
    try {
      return await execute(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          name,
          "--label",
          `pansa.session=${session}`,
          "--init",
          "--cpus",
          "2",
          "--memory",
          "2g",
          "--pids-limit",
          "512",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:rw,nosuid,size=1g",
          "--network",
          config.SANDBOX_NETWORK === "true" ? "bridge" : "none",
          "--user",
          "1000:1000",
          "-v",
          `${hostRoot}:/workspace`,
          "-w",
          "/workspace",
          "-e",
          "HOME=/workspace/.home",
          "-e",
          "npm_config_prefix=/workspace/.local",
          "-e",
          "PIP_USER=1",
          "-e",
          "PATH=/workspace/.local/bin:/workspace/.tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          config.SANDBOX_IMAGE,
          "bash",
          "-lc",
          command,
        ],
        combined,
      );
    } finally {
      combined.removeEventListener("abort", cleanup);
      cleanup();
    }
  }
}

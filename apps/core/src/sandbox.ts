import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function execute(
  command: string,
  args: string[],
  signal: AbortSignal,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(command, args, {
      cwd,
      env: { PATH: process.env.PATH, HOME: "/tmp", LANG: "C.UTF-8" },
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
  async kill(session: string): Promise<number> {
    if (!/^[a-f0-9-]{36}$/.test(session)) return 0;
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
    const root = path.join(config.workspace, session);
    await fs.mkdir(root, { recursive: true });
    return root;
  }
  async run(
    session: string,
    command: string,
    signal: AbortSignal,
    timeout = 60000,
  ): Promise<string> {
    const root = await this.root(session),
      combined = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.min(timeout, 300000)),
      ]);
    if (config.ALLOW_UNSANDBOXED === "true")
      return execute("bash", ["-lc", command], combined, root);
    const name = `pansa-${session}-${crypto.randomUUID().slice(0, 8)}`;
    const hostRoot = path.join(
      config.HOST_WORKSPACE_DIR ?? config.workspace,
      session,
    );
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
          "1",
          "--memory",
          "512m",
          "--pids-limit",
          "128",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,nosuid,size=128m",
          "--network",
          config.SANDBOX_NETWORK === "true" ? "bridge" : "none",
          "--user",
          `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
          "-v",
          `${hostRoot}:/workspace`,
          "-w",
          "/workspace",
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

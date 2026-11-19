#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { providerPresets } from "./provider-presets.js";

const home = path.resolve(process.env.PANSA_HOME ?? path.join(os.homedir(), ".pansa"));
const envFile = path.join(home, ".env");
const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
let core: ChildProcess | undefined;

async function ensureEnv() {
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const current = await fs.readFile(envFile, "utf8").catch(() => "");
  const keys = new Set(current.split(/\r?\n/).map((line) => line.split("=", 1)[0]));
  const additions = [
    ...(!keys.has("MASTER_KEY") ? [`MASTER_KEY=${randomBytes(32).toString("hex")}`] : []),
    ...(!keys.has("DASH_TOKEN") ? [`DASH_TOKEN=${randomBytes(32).toString("hex")}`] : []),
    ...(!keys.has("PANSA_HOME") ? [`PANSA_HOME=${home}`] : []),
  ];
  if (additions.length) await fs.writeFile(envFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`, { mode: 0o600 });
  await fs.chmod(envFile, 0o600);
  const text = await fs.readFile(envFile, "utf8");
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line)).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; })) as Record<string, string>;
}
const fileEnv = await ensureEnv();
const env: Record<string, string> = {
  ...fileEnv,
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  MASTER_KEY: fileEnv.MASTER_KEY ?? "",
  DASH_TOKEN: fileEnv.DASH_TOKEN ?? "",
  PANSA_HOME: home,
};
const base = `http://127.0.0.1:${env.PORT || "3001"}`;
const headers = { authorization: `Bearer ${env.DASH_TOKEN}`, "content-type": "application/json" };

async function request(route: string, body?: unknown, method?: string) {
  const response = await fetch(`${base}${route}`, { method: method ?? (body ? "POST" : "GET"), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let result: unknown = text;
  try { result = JSON.parse(text) as unknown; } catch {}
  if (!response.ok) throw new Error(String((result as Record<string, unknown>)?.error ?? `HTTP ${response.status}`));
  return result as Record<string, unknown>;
}
async function waitForCore() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }); return; } catch { await new Promise((resolve) => setTimeout(resolve, 300)); }
  }
  throw new Error("Core did not become ready within 30 seconds");
}
async function startCore() {
  try { await waitForCore(); return; } catch {}
  core = spawn(process.execPath, [`--env-file=${envFile}`, path.join(coreRoot, "dist", "index.js")], {
    cwd: process.cwd(),
    env: { ...process.env, ...fileEnv, PORT: process.env.PORT ?? fileEnv.PORT ?? "3001", PANSA_HOME: home, WORKSPACE_DIR: process.env.WORKSPACE_DIR ?? fileEnv.WORKSPACE_DIR ?? process.cwd(), EXEC_MODE: process.env.EXEC_MODE ?? fileEnv.EXEC_MODE ?? "host" },
    stdio: "ignore",
    detached: true,
  });
  core.unref();
  await waitForCore();
}
async function sessionId(continueSession: boolean) {
  const last = path.join(home, "last-session");
  if (continueSession) {
    const rows = await request("/api/sessions") as unknown as Record<string, unknown>[];
    const id = String((await fs.readFile(last, "utf8").catch(() => "")) || (rows.find((row) => String(row.title ?? "").startsWith("CLI "))?.id ?? ""));
    if (id && rows.some((row) => row.id === id)) return id;
  }
  const created = await request("/api/sessions", { title: `CLI ${path.basename(process.cwd())}` });
  await fs.writeFile(last, String(created.id), { mode: 0o600 });
  return String(created.id);
}
async function socketCookie() {
  const response = await fetch(`${base}/api/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: env.DASH_TOKEN }) });
  if (!response.ok) throw new Error("WebSocket authentication failed");
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
async function runPrompt(prompt: string, options: { yes?: boolean; plan?: boolean; interactive?: boolean; session?: string; askApproval?: (text: string) => Promise<string> } = {}) {
  await startCore();
  const id = options.session ?? await sessionId(false);
  await request(`/api/sessions/${id}/workspace`, { directory: process.cwd() }, "PUT");
  if (options.plan) await request(`/api/sessions/${id}/mode`, { mode: "plan" });
  if (options.yes) await request(`/api/sessions/${id}`, { auto_approve: true, pinned: null, strict: false }, "PATCH");
  const cookie = await socketCookie();
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(base).port}/ws`, { headers: { cookie, origin: env.PUBLIC_URL || "http://localhost:3000" } });
  const rl = options.interactive && !options.askApproval ? createInterface({ input: stdin, output: stdout }) : undefined;
  let finalStatus: string | undefined;
  const done = new Promise<void>((resolve, reject) => {
    ws.on("message", (raw) => {
      const event = JSON.parse(String(raw)) as { type?: string; session_id?: string; data?: Record<string, unknown> };
      if (event.session_id !== id) return;
      if (event.type === "token") { stdout.write(String(event.data?.text ?? "")); }
      else if (event.type === "tool") {
        if (event.data?.status === "running") stdout.write(`\n[alat] ${String(event.data.name)}${event.data.command ? ` · ${String(event.data.command)}` : ""}\n`);
      }
      else if (event.type === "progress" && event.data?.kind === "question" && options.interactive) {
        const id = String(event.data.id);
        const choices = (event.data.options as { label: string }[] | undefined)?.map((option, index) => `${index + 1}. ${option.label}`).join("\n") ?? "";
        const ask = options.askApproval ?? ((text: string) => rl!.question(text));
        void ask(`\n${String(event.data.question)}\n${choices}\nJawaban: `).then((answer) => {
          const index = Number(answer.trim()) - 1;
          const label = Number.isInteger(index) && index >= 0 ? (event.data!.options as { label: string }[])[index]?.label : answer;
          return request(`/api/questions/${id}`, { answer: label ?? answer }, "POST");
        });
      } else if (event.type === "progress" && event.data?.kind === "question") stdout.write(`\nKeputusan pengguna diperlukan: ${String(event.data.question)}\n`);
      else if (event.type === "approval" && options.interactive) {
        const approvalId = String(event.data?.id);
        const question = options.askApproval ?? ((text: string) => rl!.question(text));
        void question(`\nApproval: ${String(event.data?.tool)} ${JSON.stringify(event.data?.args)}\n${String(event.data?.notice ?? "")}\n${event.data?.allowSession ? "[y] allow once · [s] allow for session · [N] deny" : "[y] allow once · [N] deny"}: `).then((answer) => {
          const sessionGrant = event.data?.allowSession && /^s(ession)?$/i.test(answer.trim());
          return request(`/api/approvals/${approvalId}`, { approved: Boolean(sessionGrant) || /^y(es)?$/i.test(answer.trim()), duration: sessionGrant ? "session" : "once" }, "POST").then(() => {});
        }).catch(error => stdout.write(`\nApproval failed: ${error instanceof Error ? error.message : String(error)}\n`));
      } else if (event.type === "approval" && !options.interactive) {
        const approvalId = String(event.data?.id);
        void request(`/api/approvals/${approvalId}`, { approved: false }, "POST").then(() => { stdout.write("\nApproval required; task cancelled. Use an interactive terminal, or --yes for routine actions.\n"); });
      } else if (event.type === "task" && event.data?.status !== "running") { finalStatus = String(event.data?.status); stdout.write(`\n\nStatus: ${finalStatus}\n`); resolve(); }
      else if (event.type === "error") { stdout.write(`\nError: ${String(event.data?.error ?? "Task failed")}\n`); finalStatus = "error"; resolve(); }
    });
    ws.on("error", reject);
    ws.on("open", () => void request(`/api/sessions/${id}/message`, { prompt }).catch(reject));
    ws.on("close", () => { if (!finalStatus) reject(new Error("WebSocket disconnected before the task finished")); });
  });
  await done.finally(() => { ws.close(); rl?.close(); });
  return finalStatus === "done" ? 0 : 1;
}

async function secretQuestion(rl: ReturnType<typeof createInterface>, prompt: string) {
  if (!stdin.isTTY) return rl.question(prompt);
  stdout.write(prompt);
  stdin.setRawMode(true); stdin.resume();
  return new Promise<string>((resolve) => {
    let value = "";
    const onKey = (buffer: Buffer) => {
      const key = buffer.toString();
      if (key === "\r" || key === "\n") { stdin.setRawMode(false); stdin.off("data", onKey); stdout.write("\n"); resolve(value); }
      else if (key === "\u0003") { process.exit(130); }
      else if (key === "\u007f") value = value.slice(0, -1);
      else if (key >= " ") value += key;
    };
    stdin.on("data", onKey);
  });
}

async function saveTelegram(token: string, adminIds: string) {
  const current = await fs.readFile(envFile, "utf8");
  const replacements = new Map([["BOT_TOKEN", token.trim()], ["ADMIN_IDS", adminIds.trim()], ["TELEGRAM_MODE", "auto"]]);
  const seen = new Set<string>();
  const lines = current.split(/\r?\n/).flatMap((line) => {
    const key = /^([A-Z_][A-Z0-9_]*)=/.exec(line)?.[1];
    if (!key || !replacements.has(key)) return [line];
    if (seen.has(key)) return [];
    seen.add(key);
    return [`${key}=${replacements.get(key)}`];
  }).filter((line, index, all) => line || index < all.length - 1);
  for (const [key, value] of replacements) if (!seen.has(key)) lines.push(`${key}=${value}`);
  const temp = `${envFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  await fs.rename(temp, envFile);
  await fs.chmod(envFile, 0o600);
}

async function main() {
  const command = args.find((arg) => !arg.startsWith("--"));
  if (command === "serve") {
    const root = path.resolve(coreRoot, "../..");
    const dashboardPort = Number(env.DASHBOARD_PORT || 3000);
    const internalDashboardPort = Number(env.DASHBOARD_INTERNAL_PORT || (dashboardPort === 3000 ? 3100 : dashboardPort + 1000));
    const corePort = Number(env.PORT || 3001);
    const coreChild = spawn(process.execPath, [`--env-file=${envFile}`, path.join(coreRoot, "dist", "index.js")], { cwd: process.cwd(), env: { ...process.env, ...fileEnv, PORT: process.env.PORT ?? fileEnv.PORT ?? "3001", PANSA_HOME: home, WORKSPACE_DIR: process.env.WORKSPACE_DIR ?? fileEnv.WORKSPACE_DIR ?? process.cwd(), EXEC_MODE: process.env.EXEC_MODE ?? fileEnv.EXEC_MODE ?? "host" }, stdio: "inherit" });
    const standalone = path.join(root, "apps/dashboard/.next/standalone");
    const dashboard = spawn(process.execPath, [path.join(standalone, "apps/dashboard/server.js")], { cwd: standalone, env: { ...process.env, PORT: String(internalDashboardPort), HOSTNAME: "127.0.0.1" }, stdio: "inherit" });
    const proxy = http.createServer((req, res) => {
      const upstream = http.request({ hostname: "127.0.0.1", port: internalDashboardPort, method: req.method, path: req.url, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      });
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Dashboard is not ready yet"); });
      req.pipe(upstream);
    });
    proxy.on("upgrade", (req, client, head) => {
      const upstream = net.connect(corePort, "127.0.0.1", () => {
        const headers = Object.entries(req.headers).map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(", ") : val}`).join("\r\n");
        upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
    proxy.listen(dashboardPort, "0.0.0.0");
    const shutdown = () => { proxy.close(); coreChild.kill("SIGTERM"); dashboard.kill("SIGTERM"); };
    process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
    coreChild.on("exit", (code) => { dashboard.kill("SIGTERM"); process.exitCode = code ?? 1; });
    dashboard.on("exit", (code) => { if (code && code !== 0) { coreChild.kill("SIGTERM"); process.exitCode = code; } });
    return;
  }
  if (command === "doctor") { await startCore(); const id = await sessionId(false); await request(`/api/sessions/${id}/workspace`, { directory: process.cwd() }, "PUT"); console.log(JSON.stringify(await request(`/api/doctor?session=${id}`), null, 2)); return; }
  if (command === "sessions") { await startCore(); const rows = await request("/api/sessions") as unknown as Record<string, unknown>[]; console.log(rows.map((row) => `${row.id} · ${row.title} · ${row.created_at}`).join("\n") || "No sessions yet."); return; }
  if (command === "provider" && args[args.indexOf(command) + 1] === "add") {
    await startCore(); const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log(providerPresets.map((preset, index) => `${index + 1}. ${preset.name}`).join("\n"));
      const choice = (await rl.question("Provider preset [1]: ")).trim() || "1";
      const preset = providerPresets[Number(choice) - 1];
      if (!preset) throw new Error("Choose a valid preset number");
      const name = (await rl.question(`Connection name [${preset.name}]: `)).trim() || preset.name;
      const base_url = (await rl.question(`API base URL [${preset.base_url}]: `)).trim() || preset.base_url;
      const adapter = (await rl.question(`API protocol (openai/responses/anthropic) [${preset.adapter}]: `)).trim() || preset.adapter;
      const api_key = await secretQuestion(rl, "API key (hidden; leave blank for unauthenticated endpoints): ");
      const customHeadersText = await secretQuestion(rl, "Custom headers as JSON (hidden; leave blank for none): ");
      const custom_headers = customHeadersText.trim() ? JSON.parse(customHeadersText) as Record<string, string> : {};
      let model = (await rl.question(`Model ID [${preset.model || "enter ? to discover"}]: `)).trim() || preset.model;
      if (model === "?") {
        const result = await request("/api/providers/models", { name, base_url, api_key, adapter, custom_headers, model: "discovery" }) as unknown as { models: { id: string }[] };
        console.log(result.models.map((item, index) => `${index + 1}. ${item.id}`).join("\n"));
        const selection = (await rl.question("Model number or exact ID: ")).trim();
        model = result.models[Number(selection) - 1]?.id ?? selection;
      }
      const priorityText = await rl.question("Fallback priority (lower first) [0]: ");
      const payload = { name, base_url, api_key, adapter, custom_headers, model, priority: priorityText.trim() ? Number(priorityText) : 0 };
      const test = await request("/api/providers/validate", payload) as unknown as { latency: number };
      console.log(`Connection verified (${test.latency} ms).`);
      await request("/api/providers", payload);
      console.log("Provider saved with encrypted credentials. Advanced settings are available in the dashboard.");
    } finally { rl.close(); }
    return;
  }
  if (command === "telegram" && args[args.indexOf(command) + 1] === "setup") {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const token = await secretQuestion(rl, "Telegram bot token (hidden): ");
      if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim())) throw new Error("Invalid Telegram bot token format");
      const adminIds = await rl.question("Telegram admin IDs (comma-separated): ");
      const ids = adminIds.split(",").map((id) => id.trim());
      if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) throw new Error("Admin IDs must be comma-separated numbers");
      await saveTelegram(token, adminIds);
    } finally { rl.close(); }
    try { execFileSync("sudo", ["-n", "systemctl", "restart", "pansa.service"], { stdio: "ignore" }); console.log("Bot settings saved in a permission-protected file (600); service restarted."); }
    catch { console.log("Settings saved to PANSA_HOME/.env (mode 600). Run `pansa serve` or restart pansa.service."); }
    return;
  }
  if (command === "run") {
    const prompt = args[1]; if (!prompt) throw new Error('Usage: pansa run "prompt"');
    process.exitCode = await runPrompt(prompt, { yes: flag("--yes"), plan: flag("--plan"), interactive: stdin.isTTY }); return;
  }
  if (command) throw new Error(`Unknown command: ${command}`);
  await startCore();
  let id = await sessionId(flag("--continue"));
  await request(`/api/sessions/${id}/workspace`, { directory: process.cwd() }, "PUT");
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`Pansa is ready · ${process.cwd()} · /help for commands`);
  while (true) {
    const line = (await rl.question("\nYou › ")).trim();
    if (!line) continue;
    if (line === "/exit") break;
    if (line === "/stop") { await request(`/api/sessions/${id}/stop`, {}, "POST"); console.log("Task stopped."); continue; }
    if (line === "/new") { id = await sessionId(false); await request(`/api/sessions/${id}/workspace`, { directory: process.cwd() }, "PUT"); console.log("New session started."); continue; }
    if (line === "/help") { console.log("/new /model /providers /memory /doctor /stop /exit"); continue; }
    if (line.startsWith("/continue")) {
      const requested = line.slice("/continue".length).trim();
      if (!requested) { console.log("Use /continue SESSION_ID (see `pansa sessions`)."); continue; }
      const rows = await request("/api/sessions") as unknown as Record<string, unknown>[];
      if (!rows.some((row) => row.id === requested)) { console.log("Session not found."); continue; }
      id = requested; await fs.writeFile(path.join(home, "last-session"), id, { mode: 0o600 });
      await request(`/api/sessions/${id}/workspace`, { directory: process.cwd() }, "PUT");
      console.log(`Continuing session ${id}.`); continue;
    }
    if (line === "/doctor") { console.log(JSON.stringify(await request(`/api/doctor?session=${id}`), null, 2)); continue; }
    if (line === "/providers") { console.log(JSON.stringify(await request("/api/providers"), null, 2)); continue; }
    if (line.startsWith("/memory")) { console.log(JSON.stringify(await request(`/api/memory?q=${encodeURIComponent(line.slice(7).trim())}&session=${encodeURIComponent(id)}`), null, 2)); continue; }
    if (/^(lupakan|forget)\s+/i.test(line)) {
      const result = await runPrompt(line, { interactive: true, session: id, askApproval: (text) => rl.question(text) });
      if (result !== 0) console.log("Confirm that the assistant verified deletion before proceeding.");
      continue;
    }
    if (line.startsWith("/model")) {
      const selected = line.slice(6).trim();
      const providers = await request("/api/providers") as unknown as Record<string, unknown>[];
      if (!selected) { console.log(JSON.stringify(providers.map(({ id, name, model, enabled }) => ({ id, name, model, enabled })), null, 2)); continue; }
      const provider = providers.find((item) => item.id === selected || item.model === selected || item.name === selected);
      if (!provider) { console.log("Provider or model not found."); continue; }
      await request(`/api/sessions/${id}`, { auto_approve: false, pinned: String(provider.id), strict: false }, "PATCH");
      console.log(`Model pinned: ${String(provider.name)} · ${String(provider.model)}`);
      continue;
    }
    await runPrompt(line, { interactive: true, session: id, askApproval: (text) => rl.question(text) });
  }
  rl.close();
}

main().catch((error) => { console.error(`pansa: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

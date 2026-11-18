import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { encrypt, decrypt, checkURL, redact, safeFetch } from "./security.js";
import { config } from "./config.js";
import type { Tools } from "./tools.js";
import path from "node:path";

export const ServerSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9_-]{0,30}$/), transport: z.enum(["http", "sse", "stdio"]), url: z.string().url().optional(), command: z.string().optional(), args: z.array(z.string()).default([]), headers: z.record(z.string()).default({}), session: z.string().uuid() }).superRefine((server, ctx) => {
  if (server.name !== "chrome-devtools") return;
  const required = ["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated", "--no-usage-statistics", "--no-performance-crux", "--executablePath=/usr/local/bin/chrome-for-testing", "--filesystemRoot=/workspace", "--redactNetworkHeaders", "--fileNavigations=false", "--chromeArg=--no-sandbox", "--chromeArg=--disable-dev-shm-usage", "--chromeArg=--download-default-directory=/workspace", "--chromeArg=--disable-features=DownloadBubble"];
  if (server.transport !== "stdio" || server.command !== "npx" || required.some(arg => !server.args.includes(arg)))
    ctx.addIssue({ code: "custom", message: "Konfigurasi chrome-devtools wajib memakai binary sandbox yang terisolasi dan terbatas ke workspace" });
});
type Server = z.infer<typeof ServerSchema>;
export class MCP {
  clients = new Map<string, Client>();
  status = new Map<string, { connected: boolean; count: number; error?: string }>();
  constructor(public tools: Tools) {}
  configs(): Server[] {
    const raw = this.tools.store.setting("mcp_servers");
    try { return JSON.parse(decrypt(raw, config.MASTER_KEY)); } catch { return []; }
  }
  list() { return this.configs().map(({ headers, ...s }) => ({ ...s, configuredSecrets: Object.keys(headers), ...(this.status.get(s.name) ?? { connected: false, count: 0 }) })); }
  async save(server: Server) {
    const list = this.configs().filter(s => s.name !== server.name);
    list.push(server);
    this.tools.store.set("mcp_servers", encrypt(JSON.stringify(list), config.MASTER_KEY));
    await this.connect(server);
  }
  async remove(name: string) {
    await this.clients.get(name)?.close().catch(() => {});
    this.clients.delete(name); this.status.delete(name);
    for (const key of this.tools.registry.keys()) if (key.startsWith(`${name}__`)) this.tools.registry.delete(key);
    this.tools.store.set("mcp_servers", encrypt(JSON.stringify(this.configs().filter(s => s.name !== name)), config.MASTER_KEY));
  }
  async removeSession(session: string) {
    const removed = this.configs().filter(server => server.session === session);
    for (const server of removed) await this.clients.get(server.name)?.close().catch(() => {});
    for (const server of removed) {
      this.clients.delete(server.name);
      this.status.delete(server.name);
      for (const key of this.tools.registry.keys()) if (key.startsWith(`${server.name}__`)) this.tools.registry.delete(key);
    }
    this.tools.store.set("mcp_servers", encrypt(JSON.stringify(this.configs().filter(server => server.session !== session)), config.MASTER_KEY));
  }
  async connect(server: Server) {
    try {
      await this.clients.get(server.name)?.close().catch(() => {});
      const client = new Client({ name: "PansaOS", version: "1.0.0" });
      if (server.transport === "stdio") {
        if (!server.command) throw new Error("Perintah stdio wajib diisi");
        if (server.args.some(arg => arg.includes("/home/") || arg.includes("docker.sock") || arg.includes(".."))) throw new Error("Argumen MCP harus dibatasi ke /workspace");
        await this.tools.sandbox.root(server.session);
        await client.connect(new StdioClientTransport({ command: "docker", args: ["run", "--rm", "-i", "--label", `pansa.session=${server.session}`, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "1000:1000", "--memory", "2g", "--cpus", "2", "--pids-limit", "512", "--network", "bridge", "-v", `${path.join(config.HOST_WORKSPACE_DIR ?? config.workspace, server.session)}:/workspace`, "-w", "/workspace", "-e", "HOME=/workspace/.home", "--tmpfs", "/tmp:rw,nosuid,size=512m", "--shm-size", "512m", config.SANDBOX_IMAGE, server.command, ...server.args], stderr: "pipe" }));
      } else {
        if (!server.url) throw new Error("URL MCP wajib diisi");
        await checkURL(server.url, false);
        const url = new URL(server.url);
        const guardedFetch = async (input: string | URL | Request, init?: RequestInit) => safeFetch(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20000) }, false);
        await client.connect(server.transport === "sse" ? new SSEClientTransport(url, { requestInit: { headers: server.headers }, fetch: guardedFetch }) : new StreamableHTTPClientTransport(url, { requestInit: { headers: server.headers }, fetch: guardedFetch }));
      }
      const remote = await client.listTools();
      for (const tool of remote.tools) {
        const name = `${server.name}__${tool.name}`;
        this.tools.add({ name, description: tool.description ?? name, schema: z.record(z.unknown()), parameters: tool.inputSchema as Record<string, unknown>, risky: true, run: async (args, ctx) => {
          if (ctx.session !== server.session) throw new Error("MCP dibatasi ke workspace session konfigurasi");
          return client.callTool({ name: tool.name, arguments: args });
        } });
      }
      this.clients.set(server.name, client);
      this.status.set(server.name, { connected: true, count: remote.tools.length });
    } catch (error) {
      this.clients.delete(server.name);
      for (const key of this.tools.registry.keys()) if (key.startsWith(`${server.name}__`)) this.tools.registry.delete(key);
      this.status.set(server.name, { connected: false, count: 0, error: error instanceof Error ? redact(error.message, [...this.tools.store.secrets, ...Object.values(server.headers)]).replace(/https?:\/\/\S+/g, "[URL]").replace(/<[^>]*>/g, "").slice(0, 300) : "Koneksi MCP gagal" });
    }
  }
}

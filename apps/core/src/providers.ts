import { z } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { decrypt, encrypt, hash, limitedBody, mask, redact } from "./security.js";
import { Store, type Row } from "./store.js";
import { customHeadersSchema } from "./provider-headers.js";
import { readResponses, responsesBody, type ResponseItem } from "./responses.js";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  responses_items?: ResponseItem[];
  responses_source?: string;
}
export interface Definition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
export interface Completion {
  text: string;
  calls: ToolCall[];
  tokens: number;
  provider: string;
  cost: number;
  responseItems?: ResponseItem[];
  responseSource?: string;
}
export const providerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  base_url: z.string().trim().url().refine(value => /^https?:\/\//i.test(value) && !new URL(value).username && !new URL(value).password && !new URL(value).search && !new URL(value).hash, "Use an HTTP(S) base URL without credentials, query parameters, or fragments").transform(value => value.replace(/\/+$/, "")),
  api_key: z.string().default(""),
  model: z.string().trim().min(1).max(200),
  adapter: z.enum(["openai", "responses", "anthropic"]).default("openai"),
  custom_headers: customHeadersSchema.default({}),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  capabilities: z.array(z.string()).default([]),
  cost_per_1k: z.number().nonnegative().default(0),
  rate_limit: z.number().int().positive().default(60),
  max_output_tokens: z.number().int().min(16).max(200000).default(4096),
  context_window: z.number().int().min(1024).max(10000000).default(32000),
  timeout_ms: z.number().int().min(5000).max(600000).default(120000),
});
export function quality(
  text: string,
  calls: ToolCall[],
  tools: Definition[],
): number {
  for (const c of calls) {
    if (!tools.some((t) => t.function.name === c.function.name)) return 0;
    try {
      JSON.parse(c.function.arguments);
    } catch {
      return 0;
    }
  }
  if (calls.length) return 1;
  if (!text.trim()) return 0;
  if (
    text.length < 180 &&
    /^(sorry|i (cannot|can't)|maaf|saya tidak bisa)/i.test(text.trim())
  )
    return 0.1;
  if (/(.{35,})\1\1/s.test(text)) return 0.1;
  return text.trim().length < 12 ? 0.4 : 1;
}
export function cooldown(level: number): number {
  return Math.min(120000 * 2 ** level, 1800000);
}
export class Providers {
  private windows = new Map<string, number[]>();
  constructor(
    public store: Store,
    private master: string,
  ) {
    this.refreshSecrets();
  }
  refreshSecrets() {
    this.store.secrets = this.store
      .all("SELECT api_key,custom_headers FROM providers")
      .flatMap((p) => [decrypt(String(p.api_key), this.master), ...Object.values(this.customHeaders(p))])
      .filter(Boolean);
  }
  private customHeaders(provider: Row): Record<string, string> {
    return provider.custom_headers ? customHeadersSchema.parse(JSON.parse(decrypt(String(provider.custom_headers), this.master))) : {};
  }
  private headers(provider: Row): Record<string, string> {
    const key = decrypt(String(provider.api_key), this.master);
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "PansaOS/1.0" };
    if (provider.adapter === "anthropic") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
    else if (key) headers.authorization = `Bearer ${key}`;
    return { ...headers, ...this.customHeaders(provider) };
  }
  save(input: unknown, id: string = randomUUID()): string {
    const p = providerSchema.parse(input);
    this.store.run(
      `INSERT INTO providers(id,name,base_url,api_key,model,adapter,priority,enabled,capabilities,cost_per_1k,rate_limit,max_output_tokens,context_window,timeout_ms,custom_headers) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key=excluded.api_key,model=excluded.model,adapter=excluded.adapter,priority=excluded.priority,enabled=excluded.enabled,capabilities=excluded.capabilities,cost_per_1k=excluded.cost_per_1k,rate_limit=excluded.rate_limit,max_output_tokens=excluded.max_output_tokens,context_window=excluded.context_window,timeout_ms=excluded.timeout_ms,custom_headers=excluded.custom_headers`,
      id,
      p.name,
      p.base_url,
      encrypt(p.api_key, this.master),
      p.model,
      p.adapter,
      p.priority,
      Number(p.enabled),
      JSON.stringify(p.capabilities),
      p.cost_per_1k,
      p.rate_limit,
      p.max_output_tokens,
      p.context_window,
      p.timeout_ms,
      encrypt(JSON.stringify(p.custom_headers), this.master),
    );
    this.refreshSecrets();
    return id;
  }
  list(): Row[] {
    return this.store
      .all("SELECT * FROM providers ORDER BY priority,name")
      .map((p) => {
        const { custom_headers: _encryptedHeaders, ...publicFields } = p;
        return {
        ...publicFields,
        api_key: mask(decrypt(String(p.api_key), this.master)),
        capabilities: JSON.parse(String(p.capabilities)) as unknown,
        configured_headers: Object.keys(this.customHeaders(p)),
      }; });
  }
  selectForSession(session: string, selection: string | null) {
    if (!this.store.get("SELECT id FROM sessions WHERE id=?", session))
      throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    let provider: Row | undefined;
    if (selection !== null) {
      const list = this.list();
      provider = list.find(row => row.id === selection);
      if (!provider) {
        const matches = list.filter(row => row.model === selection || String(row.name).toLowerCase() === selection.toLowerCase());
        if (matches.length > 1)
          throw Object.assign(new Error("Multiple connections match. Select a specific provider from the picker."), { statusCode: 400 });
        provider = matches[0];
      }
      if (!provider || !provider.enabled)
        throw Object.assign(new Error("Choose an enabled provider or select Automatic."), { statusCode: 400 });
    }
    const pinned = provider ? String(provider.id) : null;
    this.store.run("UPDATE sessions SET pinned=? WHERE id=?", pinned, session);
    this.store.event("audit", session, { action: "model_selected", pinned });
    return { pinned, provider: provider?.name ?? null, model: provider?.model ?? null };
  }
  update(id: string, input: unknown) {
    const existing = this.store.get("SELECT * FROM providers WHERE id=?", id);
    if (!existing) throw Object.assign(new Error("Provider not found"), { statusCode: 404 });
    const changes = providerSchema.partial().parse(input);
    return this.save({ ...existing, enabled: Boolean(existing.enabled), capabilities: JSON.parse(String(existing.capabilities)), ...changes, custom_headers: changes.custom_headers ?? this.customHeaders(existing), api_key: changes.api_key === undefined || changes.api_key === "" ? decrypt(String(existing.api_key), this.master) : changes.api_key }, id);
  }
  private draft(input: unknown, id?: string) {
    if (!id) return providerSchema.parse(input);
    const existing = this.store.get("SELECT * FROM providers WHERE id=?", id);
    if (!existing) throw Object.assign(new Error("Provider not found"), { statusCode: 404 });
    const changes = providerSchema.partial().parse(input);
    return providerSchema.parse({ ...existing, enabled: Boolean(existing.enabled), capabilities: JSON.parse(String(existing.capabilities)), ...changes, custom_headers: changes.custom_headers ?? this.customHeaders(existing), api_key: changes.api_key || decrypt(String(existing.api_key), this.master) });
  }
  async testDraft(input: unknown, id?: string) {
    const provider = this.draft(input, id);
    const start = Date.now();
    const result = await this.request({ ...provider, api_key: encrypt(provider.api_key, this.master), custom_headers: encrypt(JSON.stringify(provider.custom_headers), this.master) }, [{ role: "system", content: "You are PansaOS, a helpful assistant." }, { role: "user", content: "Reply with OK" }], [], AbortSignal.timeout(Math.min(provider.timeout_ms, 30000)), () => {}).catch(error => {
      const status = error instanceof Error ? error.message.match(/HTTP \d{3}/)?.[0] : undefined;
      throw Object.assign(new Error(`Connection test failed${status ? ` (${status})` : " (network, timeout, or response error)"}. Check the base URL, API protocol, key, and model ID.`), { statusCode: 400 });
    });
    if (!result.text.trim()) throw new Error("The provider returned an empty response");
    return { ok: true, latency: Date.now() - start, model: provider.model, preview: redact(result.text, [provider.api_key, ...Object.values(provider.custom_headers)]).slice(0, 120) };
  }
  async models(input: unknown, id?: string) {
    const provider = this.draft(input, id);
    const headers = this.headers({ ...provider, api_key: encrypt(provider.api_key, this.master), custom_headers: encrypt(JSON.stringify(provider.custom_headers), this.master) });
    const response = await fetch(`${provider.base_url}/models`, { headers, signal: AbortSignal.timeout(20000), redirect: "error" }).catch(() => { throw Object.assign(new Error("Could not reach the models endpoint. Check the base URL or enter a model ID manually."), { statusCode: 400 }); });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Model discovery failed (HTTP ${response.status}). You can enter a model ID manually.`), { statusCode: 400 }); }
    let data: { data?: { id?: string; display_name?: string }[] };
    try { data = JSON.parse((await limitedBody(response)).toString("utf8")); }
    catch { throw Object.assign(new Error("Model discovery returned invalid or oversized JSON. Enter a model ID manually."), { statusCode: 400 }); }
    if (!Array.isArray(data.data)) throw Object.assign(new Error("Model discovery returned an unsupported format. Enter a model ID manually."), { statusCode: 400 });
    return { models: (data.data ?? []).filter(model => typeof model.id === "string" && model.id.length > 0 && model.id.length <= 200).slice(0, 500).map(model => ({ id: model.id!, name: model.display_name ?? model.id! })).sort((a, b) => a.id.localeCompare(b.id)) };
  }
  async request(
    p: Row,
    messages: Message[],
    tools: Definition[],
    signal: AbortSignal,
    onToken: (s: string) => void,
  ): Promise<Omit<Completion, "provider" | "cost">> {
    const native = p.adapter === "anthropic";
    const headers = this.headers(p);
    if (p.adapter === "responses") {
      const source = `responses:${hash(JSON.stringify({ id: p.id ?? "draft", base: p.base_url, model: p.model, headers }))}`;
      const response = await fetch(`${String(p.base_url).replace(/\/$/, "")}/responses`, {
        method: "POST", headers,
        body: JSON.stringify(responsesBody(messages, tools, String(p.model), Number(p.max_output_tokens ?? 4096), source)),
        signal: AbortSignal.any([signal, AbortSignal.timeout(Number(p.timeout_ms ?? 120000))]), redirect: "error",
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      return { ...await readResponses(response, onToken, Math.ceil(JSON.stringify(messages).length / 4)), responseSource: source };
    }
    const body: Record<string, unknown> = {
      model: p.model,
      max_tokens: Number(p.max_output_tokens ?? 4096),
      stream: !native,
    };
    if (native) {
      body.system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n");
      body.messages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "tool" ? "user" : m.role,
          content:
            m.role === "tool"
              ? [
                  {
                    type: "tool_result",
                    tool_use_id: m.tool_call_id,
                    content: m.content ?? "",
                  },
                ]
              : m.tool_calls
                ? [
                    ...(m.content ? [{ type: "text", text: m.content }] : []),
                    ...m.tool_calls.map((c) => ({
                      type: "tool_use",
                      id: c.id,
                      name: c.function.name,
                      input: JSON.parse(c.function.arguments) as unknown,
                    })),
                  ]
                : (m.content ?? ""),
        }));
      if (tools.length)
        body.tools = tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
    } else {
      body.messages = messages.map(({ role, content, tool_calls, tool_call_id }) => ({ role, content, ...(tool_calls ? { tool_calls } : {}), ...(tool_call_id ? { tool_call_id } : {}) }));
      if (tools.length) body.tools = tools;
      body.stream_options = { include_usage: true };
    }
    const response = await fetch(
      `${String(p.base_url).replace(/\/$/, "")}/${native ? "messages" : "chat/completions"}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(Number(p.timeout_ms ?? 120000))]),
        redirect: "error",
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    if (native) {
      const data = (await response.json().catch(() => { throw new Error("Provider returned invalid JSON"); })) as {
        content: {
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }[];
        usage?: { input_tokens: number; output_tokens: number };
      };
      const text = data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      onToken(text);
      return {
        text,
        calls: data.content
          .filter((c) => c.type === "tool_use")
          .map((c) => ({
            id: c.id!,
            type: "function",
            function: { name: c.name!, arguments: JSON.stringify(c.input) },
          })),
        tokens:
          (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      };
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response");
    let buffer = "",
      text = "",
      tokens = 0;
    const calls = new Map<number, ToolCall>(),
      decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") continue;
          let decoded: unknown;
          try { decoded = JSON.parse(raw); } catch { throw new Error("Provider returned invalid stream JSON"); }
          const data = decoded as {
            error?: unknown;
            choices?: {
              delta?: {
                content?: string;
                tool_calls?: {
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
            }[];
            usage?: { total_tokens: number };
          };
          if (data.error)
            throw new Error("Provider returned a stream error");
          tokens = data.usage?.total_tokens ?? tokens;
          const delta = data.choices?.[0]?.delta;
          if (delta?.content) {
            text += delta.content;
            onToken(delta.content);
          }
          for (const part of delta?.tool_calls ?? []) {
            const c = calls.get(part.index) ?? {
              id: part.id ?? randomUUID(),
              type: "function",
              function: { name: "", arguments: "" },
            };
            if (part.id) c.id = part.id;
            c.function.name += part.function?.name ?? "";
            c.function.arguments += part.function?.arguments ?? "";
            calls.set(part.index, c);
          }
        }
      }
    } finally {
      await reader.cancel();
    }
    return {
      text,
      calls: [...calls.values()],
      tokens:
        tokens ||
        Math.ceil((JSON.stringify(messages).length + text.length) / 4),
    };
  }
  async complete(
    messages: Message[],
    tools: Definition[],
    session: string,
    signal: AbortSignal,
    onToken: (s: string) => void,
    pin?: string,
    strict = false,
    capability?: string,
  ): Promise<Completion> {
    let candidates = this.store.all(
      "SELECT * FROM providers WHERE enabled=1 ORDER BY priority",
    );
    candidates.sort(
      (a, b) =>
        (Number(b.id === pin) - Number(a.id === pin)) ||
        (capability
          ? Number(String(b.capabilities).includes(capability)) -
            Number(String(a.capabilities).includes(capability))
          : 0),
    );
    if (strict && pin) candidates = candidates.filter((p) => p.id === pin);
    const names = new Map(
      this.store
        .all("SELECT id,name FROM providers")
        .map((p) => [String(p.id), String(p.name)]),
    );
    const label = (id: string) => names.get(id) ?? id;
    let previous: string | undefined,
      reason = "";
    for (const p of candidates) {
      signal.throwIfAborted();
      const id = String(p.id);
      if (Number(p.cooldown_until) > Date.now()) continue;
      const window = (this.windows.get(id) ?? []).filter(
        (t) => t > Date.now() - 60000,
      );
      if (window.length >= Number(p.rate_limit)) {
        previous = id;
        reason = "local rate limit";
        continue;
      }
      if (previous)
        this.store.event("switch", session, {
          from: previous,
          fromName: label(previous),
          to: id,
          toName: label(id),
          reason,
        });
      for (let attempt = 0; attempt < 2; attempt++) {
        const start = Date.now();
        window.push(start);
        this.windows.set(id, window);
        this.store.run(
          "UPDATE providers SET attempts=attempts+1 WHERE id=?",
          id,
        );
        try {
          const result = await this.request(
            p,
            messages,
            tools,
            signal,
            onToken,
          );
          if (quality(result.text, result.calls, tools) < 0.5)
            throw new Error(
              "Quality gate: empty response, refusal, repetition, or invalid tool call",
            );
          this.store.run(
            "UPDATE providers SET failures=0,cooldown_until=0,cooldown_level=0,successes=successes+1,latency=? WHERE id=?",
            Date.now() - start,
            id,
          );
          const cost = (result.tokens / 1000) * Number(p.cost_per_1k);
          this.store.event("usage", session, {
            provider: id,
            tokens: result.tokens,
            cost,
            latency: Date.now() - start,
          });
          return { ...result, provider: id, cost };
        } catch (e) {
          signal.throwIfAborted();
          reason = e instanceof Error ? e.message : "Provider error";
          previous = id;
          const failures =
            Number(
              this.store.get("SELECT failures FROM providers WHERE id=?", id)
                ?.failures ?? 0,
            ) + 1;
          const level = Number(p.cooldown_level);
          this.store.run(
            "UPDATE providers SET failures=?,cooldown_until=?,cooldown_level=? WHERE id=?",
            failures,
            failures >= 2 ? Date.now() + cooldown(level) : 0,
            failures >= 2 ? level + 1 : level,
            id,
          );
          this.store.event("error", session, { provider: id, error: reason });
          if (attempt === 0 && !/HTTP (401|403)/.test(reason))
            await delay(600, undefined, { signal });
          else break;
        }
      }
    }
    throw new Error(
      "All providers failed or are cooling down. Add another provider or try again after the cooldown.",
    );
  }
  async test(id: string): Promise<{ ok: boolean; latency: number }> {
    const result = await this.testDraft({}, id);
    this.store.run(
      "UPDATE providers SET failures=0,cooldown_until=0,cooldown_level=0,latency=? WHERE id=?",
      result.latency,
      id,
    );
    return { ok: true, latency: result.latency };
  }
}

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { decrypt, encrypt, mask } from "./security.js";
import { Store, type Row } from "./store.js";

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
}
export const providerSchema = z.object({
  name: z.string().min(1),
  base_url: z.string().url(),
  api_key: z.string().default(""),
  model: z.string().min(1),
  adapter: z.enum(["openai", "anthropic"]).default("openai"),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  capabilities: z.array(z.string()).default([]),
  cost_per_1k: z.number().nonnegative().default(0),
  rate_limit: z.number().int().positive().default(60),
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
      .all("SELECT api_key FROM providers")
      .map((p) => decrypt(String(p.api_key), this.master))
      .filter(Boolean);
  }
  save(input: unknown, id = randomUUID()): string {
    const p = providerSchema.parse(input);
    this.store.run(
      `INSERT INTO providers(id,name,base_url,api_key,model,adapter,priority,enabled,capabilities,cost_per_1k,rate_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key=excluded.api_key,model=excluded.model,adapter=excluded.adapter,priority=excluded.priority,enabled=excluded.enabled,capabilities=excluded.capabilities,cost_per_1k=excluded.cost_per_1k,rate_limit=excluded.rate_limit`,
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
    );
    this.refreshSecrets();
    return id;
  }
  list(): Row[] {
    return this.store
      .all("SELECT * FROM providers ORDER BY priority,name")
      .map((p) => ({
        ...p,
        api_key: mask(decrypt(String(p.api_key), this.master)),
        capabilities: JSON.parse(String(p.capabilities)) as unknown,
      }));
  }
  async request(
    p: Row,
    messages: Message[],
    tools: Definition[],
    signal: AbortSignal,
    onToken: (s: string) => void,
  ): Promise<Omit<Completion, "provider" | "cost">> {
    const key = decrypt(String(p.api_key), this.master),
      native = p.adapter === "anthropic";
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (native) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else if (key) headers.authorization = `Bearer ${key}`;
    const body: Record<string, unknown> = {
      model: p.model,
      max_tokens: 4096,
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
      body.messages = messages;
      if (tools.length) body.tools = tools;
      body.stream_options = { include_usage: true };
    }
    const response = await fetch(
      `${String(p.base_url).replace(/\/$/, "")}/${native ? "messages" : "chat/completions"}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    if (native) {
      const data = (await response.json()) as {
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
    if (!reader) throw new Error("Respons kosong");
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
          const data = JSON.parse(raw) as {
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
            throw new Error("Provider mengembalikan stream error");
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
        Number(b.id === pin) -
        Number(a.id === pin) +
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
        reason = "rate limit lokal";
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
              "Quality gate: respons kosong/refusal/repetisi/tool invalid",
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
      "Semua provider gagal atau cooldown. Tambahkan provider atau coba setelah cooldown.",
    );
  }
  async test(id: string): Promise<{ ok: boolean; latency: number }> {
    const p = this.store.get("SELECT * FROM providers WHERE id=?", id);
    if (!p) throw new Error("Provider tidak ditemukan");
    const start = Date.now();
    const r = await this.request(
      p,
      [{ role: "user", content: "Reply with OK" }],
      [],
      AbortSignal.timeout(20000),
      () => {},
    );
    if (!r.text.trim()) throw new Error("Respons kosong");
    this.store.run(
      "UPDATE providers SET failures=0,cooldown_until=0,latency=? WHERE id=?",
      Date.now() - start,
      id,
    );
    return { ok: true, latency: Date.now() - start };
  }
}

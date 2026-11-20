import { describe, expect, it, vi } from "vitest";
import { estimateTokens, fitContext } from "./context-window.js";
import { Providers, type Message } from "./providers.js";
import { SessionState } from "./session-state.js";
import { Store } from "./store.js";

describe("context fitting", () => {
  it("fits a long single-turn task without discarding the goal or separating recent tool results from their calls", () => {
    const system: Message = { role: "system", content: "Current task state: verify the result" };
    const goal: Message = { role: "user", content: "Inspect and verify the project" };
    const history: Message[] = [system, goal];
    for (let i = 0; i < 12; i++) {
      history.push({ role: "assistant", content: null, tool_calls: [{ id: `call_${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `file-${i}` }) } }] });
      history.push({ role: "tool", tool_call_id: `call_${i}`, content: `Result ${i}\n${"long output ".repeat(3000)}\nEnd ${i}` });
    }
    const budget = 2048;
    const fitted = fitContext(history, budget);
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(budget);
    expect(fitted).toContain(goal);
    expect(fitted.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_11", content: expect.stringContaining("End 11") });
    for (const [i, message] of fitted.entries()) {
      if (message.role === "tool") expect(fitted[i - 1]?.tool_calls?.[0]?.id).toBe(message.tool_call_id);
    }
    expect(history.at(-1)?.content?.length).toBeGreaterThan(30000);
  });

  it("reports oversized current instructions before sending an unusable request", () => {
    const messages: Message[] = [{ role: "system", content: "Context" }, { role: "user", content: "x".repeat(8000) }];
    expect(() => fitContext(messages, 1000)).toThrow("current instructions and request exceed");
  });

  it("retries a provider context-limit response with smaller input on the same model", async () => {
    const master = "a".repeat(64);
    const store = new Store(":memory:");
    try {
      const providers = new Providers(store, master);
      const id = providers.save({ name: "Preferred", base_url: "https://example.com/v1", model: "preferred" });
      providers.save({ name: "Fallback", base_url: "https://example.com/v1", model: "fallback", priority: 1 });
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "context_length_exceeded" } }), { status: 400 }))
        .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Finished the task successfully."}}]}\n\n'));
      vi.stubGlobal("fetch", fetch);
      const messages: Message[] = [{ role: "user", content: "Continue the task" }];
      const prepare = vi.fn((_, tighter) => tighter ? messages : [{ role: "user" as const, content: "Older context" }, ...messages]);
      const result = await providers.complete(messages, [], store.session().id, AbortSignal.timeout(1000), () => {}, id, false, undefined, prepare);
      expect(result.provider).toBe(id);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)).messages.length)).toEqual([2, 1]);
      expect(store.get("SELECT failures FROM providers WHERE id=?", id)?.failures).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      store.db.close();
    }
  });

  it("continues on the successful fallback after a long tool result without a model request for compaction", async () => {
    const master = "a".repeat(64);
    vi.stubEnv("MASTER_KEY", master);
    vi.stubEnv("DASH_TOKEN", "test-dash-token-0123456789abcdef");
    const store = new Store(":memory:");
    try {
      const { Agent } = await import("./agent.js");
      const providers = new Providers(store, master);
      const primary = providers.save({ name: "Primary", base_url: "https://example.com/v1", model: "primary" });
      const fallback = providers.save({ name: "Fallback", base_url: "https://example.com/v1", model: "fallback", priority: 1 });
      const definition = { type: "function" as const, function: { name: "read_file", description: "Read a file", parameters: { type: "object" } } };
      const toolCall = { id: "call_1", type: "function" as const, function: { name: "read_file", arguments: '{"path":"result.txt"}' } };
      const request = vi.spyOn(providers, "request")
        .mockRejectedValueOnce(new Error("HTTP 401"))
        .mockResolvedValueOnce({ text: "", calls: [toolCall], tokens: 50 })
        .mockResolvedValueOnce({ text: "Finished verifying the result.", calls: [], tokens: 50 });
      const output = "line from output\n".repeat(10000) + "Verified result";
      const agent = new Agent(store, providers, {
        state: new SessionState(store),
        humanWait: new Map(),
        sandbox: { root: async () => process.cwd() },
        profile: { relevant: async () => "" },
        skills: { relevant: async () => "" },
        registry: new Map(),
        definitions: () => [definition],
        call: async () => output,
      } as unknown as ConstructorParameters<typeof Agent>[2]);
      const session = store.session().id;
      await expect(agent.run(session, "Verify the result")).resolves.toBe("Finished verifying the result.");
      expect(request.mock.calls.map(([provider]) => provider.id)).toEqual([primary, fallback, fallback]);
      const finalInput = request.mock.calls[2]![1];
      expect(estimateTokens(finalInput)).toBeLessThan(25000);
      expect(finalInput.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1", content: expect.stringContaining("Verified result") });
      expect(JSON.parse(String(store.get("SELECT payload FROM messages WHERE json_extract(payload,'$.role')='tool'")?.payload)).content).toBe(output);
    } finally {
      vi.unstubAllEnvs();
      store.db.close();
    }
  });
});

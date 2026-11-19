import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store.js";
import { Providers, type Definition, type Message } from "./providers.js";
import { readResponses, responsesBody, type ResponseItem } from "./responses.js";

const key = "a".repeat(64);
const tools: Definition[] = [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
const message: ResponseItem = { type: "message", id: "msg_1", role: "assistant", status: "completed", phase: "final_answer", content: [{ type: "output_text", text: "Hello 😀", annotations: [] }] };
const reason: ResponseItem = { type: "reasoning", id: "reason_1", encrypted_content: "encrypted-reasoning", summary: [] };
const call: ResponseItem = { type: "function_call", id: "fc_item", call_id: "call_123", name: "read_file", arguments: '{"path":"notes.txt"}', status: "completed" };
const event = (type: string, data: Record<string, unknown>) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...data })}\r\n\r\n`;
function stream(text: string, size = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Responses protocol", () => {
  it("maps system instructions, function tools, calls, and tool outputs to the Responses wire format", () => {
    const messages: Message[] = [{ role: "system", content: "Be helpful" }, { role: "user", content: "Read my notes" }, { role: "assistant", content: null, tool_calls: [{ id: "call_123", type: "function", function: { name: "read_file", arguments: '{"path":"notes.txt"}' } }] }, { role: "tool", tool_call_id: "call_123", content: "notes contents" }];
    const body = responsesBody(messages, tools, "test-model", 8192, "provider:model");
    expect(body).toMatchObject({ instructions: "Be helpful", model: "test-model", max_output_tokens: 8192, stream: true, store: false, include: ["reasoning.encrypted_content"] });
    expect(body.tools![0]).toMatchObject({ type: "function", name: "read_file", strict: false });
    expect(body.input).toContainEqual({ type: "function_call", call_id: "call_123", name: "read_file", arguments: '{"path":"notes.txt"}' });
    expect(body.input.at(-1)).toEqual({ type: "function_call_output", call_id: "call_123", output: "notes contents" });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("max_tokens");
  });
  it("parses byte-split UTF-8 and CRLF text events without duplicating the final text", async () => {
    const onToken = vi.fn();
    const wire = event("response.created", { response: { status: "in_progress" } }) + event("response.output_text.delta", { delta: "Hello " }) + event("response.output_text.delta", { delta: "😀" }) + event("response.completed", { response: { status: "completed", output: [message], usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } } });
    const result = await readResponses(stream(wire, 1), onToken, 100);
    expect(result).toMatchObject({ text: "Hello 😀", calls: [], tokens: 10 });
    expect(onToken.mock.calls.map(args => args[0]).join("")).toBe("Hello 😀");
  });
  it("returns authoritative function arguments and call IDs after streamed argument deltas", async () => {
    const wire = event("response.output_item.added", { item: { ...call, arguments: "" } }) + event("response.function_call_arguments.delta", { item_id: "fc_item", delta: '{"path":' }) + event("response.function_call_arguments.delta", { item_id: "fc_item", delta: '"notes.txt"}' }) + event("response.output_item.done", { item: call }) + event("response.completed", { response: { status: "completed", output: [reason, call], usage: { input_tokens: 10, output_tokens: 5 } } });
    const result = await readResponses(stream(wire), vi.fn(), 99);
    expect(result.calls).toEqual([{ id: "call_123", type: "function", function: { name: "read_file", arguments: '{"path":"notes.txt"}' } }]);
    expect(result.tokens).toBe(15);
    expect(result.responseItems).toEqual([reason, call]);
  });
  it("preserves reasoning, message phase, and tool calls only for their original provider/model", () => {
    const messages: Message[] = [{ role: "assistant", content: "Hello 😀", tool_calls: [{ id: "call_123", type: "function", function: { name: "read_file", arguments: call.arguments! } }], responses_source: "original:model", responses_items: [reason, message, call] }];
    expect(responsesBody(messages, tools, "model", 100, "original:model").input).toEqual([reason, message, call]);
    const switched = responsesBody(messages, tools, "other", 100, "other:model").input;
    expect(switched.some(item => item.type === "reasoning")).toBe(false);
    expect(switched).toContainEqual({ type: "function_call", call_id: "call_123", name: "read_file", arguments: call.arguments });
  });
  it("accepts JSON Responses and completion-only event streams", async () => {
    const token = vi.fn();
    const envelope = { status: "completed", output: [message] };
    const json = new Response(JSON.stringify(envelope), { headers: { "content-type": "application/json" } });
    await expect(readResponses(json, token, 42)).resolves.toMatchObject({ text: "Hello 😀", tokens: 42 });
    const wire = `data: ${JSON.stringify({ type: "response.completed", response: envelope })}`;
    await expect(readResponses(stream(wire), token, 42)).resolves.toMatchObject({ text: "Hello 😀" });
    expect(token).toHaveBeenCalledTimes(2);
  });
  it("finishes and releases the stream as soon as a complete response arrives", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(event("response.completed", { response: { status: "completed", output: [message] } }))); }, cancel });
    await expect(readResponses(new Response(body), vi.fn(), 1)).resolves.toMatchObject({ text: "Hello 😀" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects failed, incomplete, malformed, and prematurely closed streams", async () => {
    for (const type of ["error", "response.failed", "response.incomplete"])
      await expect(readResponses(stream(event(type, {})), vi.fn(), 1)).rejects.toThrow("stream failed");
    await expect(readResponses(stream(event("response.output_text.delta", { delta: "partial" })), vi.fn(), 1)).rejects.toThrow("before response.completed");
    await expect(readResponses(stream("data: not-json\n\n"), vi.fn(), 1)).rejects.toThrow();
    await expect(readResponses(stream(event("response.completed", { response: { status: "incomplete", output: [call] } })), vi.fn(), 1)).rejects.toThrow("did not complete");
  });
  it("uses /responses with custom headers, and keeps protocol metadata out of Chat Completions", async () => {
    const store = new Store(":memory:");
    try {
      const fetch = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith("/responses") ? stream(event("response.completed", { response: { status: "completed", output: [message] } })) : new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'));
      vi.stubGlobal("fetch", fetch);
      const providers = new Providers(store, key);
      const id = providers.save({ name: "Responses", base_url: "https://example.com/v1", model: "test", adapter: "responses", custom_headers: { "User-Agent": "Pansa-custom", "X-Gateway-Key": "header-secret" } });
      const provider = store.get("SELECT * FROM providers WHERE id=?", id)!;
      const result = await providers.request(provider, [{ role: "user", content: "Hello" }], tools, AbortSignal.timeout(2000), vi.fn());
      expect(result.responseSource).toMatch(/^responses:[a-f0-9]{64}$/);
      const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe("https://example.com/v1/responses");
      expect(init.headers).toMatchObject({ "user-agent": "Pansa-custom", "x-gateway-key": "header-secret" });
      const history: Message[] = [{ role: "assistant", content: result.text, responses_items: result.responseItems, responses_source: result.responseSource }];
      await providers.request({ ...provider, adapter: "openai" }, history, [], AbortSignal.timeout(2000), vi.fn());
      const chatInit = fetch.mock.calls[1]![1] as RequestInit;
      expect(JSON.parse(String(chatInit.body)).messages).toEqual([{ role: "assistant", content: "Hello 😀" }]);
    } finally { store.db.close(); }
  });
});

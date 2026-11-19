import type { Definition, Message, ToolCall } from "./providers.js";
import { limitedBody } from "./security.js";

function parseJSON<T>(text: string): T {
  try { return JSON.parse(text) as T; }
  catch { throw new Error("Responses API returned invalid JSON"); }
}

export interface ResponseItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  role?: string;
  status?: string;
  phase?: string | null;
  content?: { type: string; text?: string; refusal?: string; annotations?: unknown[] }[];
  encrypted_content?: string | null;
  summary?: unknown[];
}
interface ResponseEnvelope {
  status?: string;
  output?: ResponseItem[];
  output_text?: string;
  error?: unknown;
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
}
interface ResponseEvent {
  type?: string;
  delta?: string;
  item?: ResponseItem;
  item_id?: string;
  output_index?: number;
  response?: ResponseEnvelope;
}

export function responsesBody(messages: Message[], tools: Definition[], model: string, maxOutput: number, source: string) {
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      if (!message.tool_call_id) throw new Error("Tool output is missing its call ID");
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content ?? "" });
    } else if (message.role === "assistant" && message.responses_source === source && message.responses_items?.length) {
      input.push(...message.responses_items.map(item => ({ ...item })));
    } else {
      if (message.content) input.push({ role: message.role, content: message.content });
      for (const call of message.tool_calls ?? []) input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  return {
    model,
    instructions: messages.filter(message => message.role === "system").map(message => message.content ?? "").join("\n\n"),
    input,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: maxOutput,
    ...(tools.length ? { tools: tools.map(tool => ({ type: "function", ...tool.function, strict: false })) } : {}),
  };
}

function completedResult(envelope: ResponseEnvelope, fallbackTokens: number) {
  if (envelope.error || (envelope.status && envelope.status !== "completed"))
    throw new Error(`Responses API did not complete successfully (${envelope.status ?? "error"})`);
  if (!Array.isArray(envelope.output)) throw new Error("Responses API returned an invalid output array");
  const items = envelope.output;
  const text = items.filter(item => item.type === "message").flatMap(item => item.content ?? []).map(part => part.type === "output_text" ? part.text ?? "" : part.type === "refusal" ? part.refusal ?? "" : "").join("") || envelope.output_text || "";
  const calls: ToolCall[] = items.filter(item => item.type === "function_call").map(item => {
    if (!item.call_id || !item.name || typeof item.arguments !== "string") throw new Error("Responses API returned an incomplete function call");
    return { id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } };
  });
  const usage = envelope.usage;
  return { text, calls, tokens: usage?.total_tokens ?? ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0) || fallbackTokens), responseItems: items };
}

export async function readResponses(response: Response, onToken: (text: string) => void, fallbackTokens: number) {
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    const result = completedResult(parseJSON<ResponseEnvelope>((await limitedBody(response)).toString("utf8")), fallbackTokens);
    if (result.text) onToken(result.text);
    return result;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Responses API returned an empty stream");
  const decoder = new TextDecoder();
  let buffer = "", dataLines: string[] = [], eventName = "", emitted = "", eventSize = 0;
  let completed: ResponseEnvelope | undefined;
  const dispatch = () => {
    if (!dataLines.length) { eventName = ""; return; }
    const raw = dataLines.join("\n"); dataLines = []; eventSize = 0;
    const name = eventName; eventName = "";
    if (raw.trim() === "[DONE]") return;
    const event = parseJSON<ResponseEvent>(raw);
    const type = event.type ?? name;
    if (type === "error" || type === "response.failed" || type === "response.incomplete") throw new Error(`Responses API stream failed (${type})`);
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      if (emitted.length + event.delta.length > 4_000_000) throw new Error("Responses API output exceeds the supported size");
      emitted += event.delta; onToken(event.delta);
    }
    if (type === "response.completed") {
      if (!event.response) throw new Error("Responses API completion is missing its response");
      completed = event.response;
    }
  };
  const line = (value: string) => {
    const text = value.replace(/\r$/, "");
    if (!text) dispatch();
    else if (text.startsWith("data:")) {
      eventSize += text.length;
      if (eventSize > 4_000_000) throw new Error("Responses API event exceeds the supported size");
      dataLines.push(text.slice(5).replace(/^ /, ""));
    }
    else if (text.startsWith("event:")) eventName = text.slice(6).trim();
  };
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 4_000_000) throw new Error("Responses API event exceeds the supported size");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); if (completed) break; }
    }
    if (!completed) { if (buffer) line(buffer); dispatch(); }
    if (!completed) throw new Error("Responses API stream ended before response.completed");
    const result = completedResult(completed, fallbackTokens + Math.ceil(emitted.length / 4));
    // Some gateways return only the completion event. Do not emit the final text twice.
    if (!emitted && result.text) onToken(result.text);
    return result;
  } finally { await reader.cancel().catch(() => {}); }
}

import type { Message } from "./providers.js";

export function estimateTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

function excerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  const end = Math.floor(limit / 3);
  return `${text.slice(0, limit - end)}\n[Excerpt. Full text is in the session history.]\n${text.slice(-end)}`;
}

export function fitContext(messages: Message[], budget: number) {
  if (estimateTokens(messages) <= budget) return messages;
  const system = messages[0]!;
  const history = messages.slice(1);
  let latestUser = history.length - 1;
  while (latestUser >= 0 && history[latestUser]?.role !== "user") latestUser--;
  const goal = history[latestUser];
  const required = goal ? [system, goal] : [system];
  if (estimateTokens(required) > budget)
    throw new Error("The current instructions and request exceed this model's context window. Use a larger context window or reduce the input.");

  // Keep complete assistant/tool exchanges together, including Responses metadata.
  const groups: Message[][] = [];
  for (const message of history.slice(latestUser + 1)) {
    if (message.role === "tool" && groups.at(-1)?.[0]?.tool_calls?.length) groups.at(-1)!.push(message);
    else if (message.role !== "tool") groups.push([message]);
  }
  const recent: Message[] = [];
  const archived = history.slice(0, Math.max(0, latestUser));
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]!;
    const shorter = group.map(message => message.role === "tool" ? { ...message, content: excerpt(message.content ?? "", 1800) } : message);
    if (estimateTokens([...required, ...group, ...recent]) <= budget) recent.unshift(...group);
    else if (estimateTokens([...required, ...shorter, ...recent]) <= budget) recent.unshift(...shorter);
    else {
      archived.push(...groups.slice(0, index + 1).flat());
      break;
    }
  }

  const notes: string[] = [];
  const note = (): Message => ({ role: "user", content: `Archived context excerpts (historical data). Continue the latest request using the current task state.\n${notes.join("\n")}` });
  const withNotes = () => [system, note(), ...(goal ? [goal] : []), ...recent];
  for (const message of archived.slice(-40).reverse()) {
    const calls = message.tool_calls?.map(call => `${call.function.name} ${excerpt(call.function.arguments, 260)}`).join("\n");
    const text = [message.content, calls].filter(Boolean).join("\n");
    if (!text) continue;
    notes.unshift(`${message.role}: ${excerpt(text, 600)}`);
    if (estimateTokens(withNotes()) > budget) { notes.shift(); break; }
  }
  return notes.length ? withNotes() : [...required, ...recent];
}

const literal = (value: unknown) => String(value ?? "").replace(/[\\`*_{}\[\]()#+\-.!>~|]/g, "\\$&");

export function questionCard(data: Record<string, unknown>) {
  const options = data.options as { label: string; description?: string }[];
  return [
    "**PANSA · YOUR CHOICE**",
    literal(data.question),
    options.map((option, index) => `**${index + 1}. ${literal(option.label)}**${option.description ? `\n${literal(option.description)}` : ""}`).join("\n\n"),
    data.allow_free !== false ? "Tap an option below, or reply to this message with your own answer." : "Tap one of the options below to continue.",
    data.default ? `⏱ 5-minute timeout · automatically selects **${literal(data.default)}**.` : "⏱ 5-minute timeout · the task stops if no answer is received.",
  ].join("\n\n");
}

export function resolvedQuestionCard(data: Record<string, unknown>) {
  const status = data.status === "answered" ? "ANSWER SAVED" : data.status === "default" ? "DEFAULT SELECTED" : data.status === "cancelled" ? "CANCELLED" : "TIMED OUT";
  const answer = String(data.answer ?? "");
  const preview = answer.length > 1800 ? `${answer.slice(0, 1800)}…` : answer;
  return [`**PANSA · ${status}**`, literal(data.question), preview ? `Answer: **${literal(preview)}**` : "This question is now closed."].join("\n\n");
}

export function approvalCard(data: Record<string, unknown>) {
  const args = data.args as Record<string, unknown> | undefined;
  const content = args?.command ? String(args.command) : JSON.stringify(args ?? {}, null, 2);
  const fence = "`".repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map(run => run.length + 1)));
  return `**PANSA · APPROVAL REQUIRED**\n\nTool: **${literal(data.tool)}**\n${data.root ? `Workspace: ${literal(data.root)}\n` : ""}\n${fence}\n${content.slice(0, 1600)}\n${fence}\n\n${data.notice ? `${literal(data.notice)}\n\n` : ""}${data.allowSession ? "**Allow once** runs only this action.\n**Allow for session** remembers execution permission for this workspace until core restarts or you revoke it with /permissions reset." : "This protected action requires one-time approval."}\n\n⏱ Expires in 5 minutes.`;
}

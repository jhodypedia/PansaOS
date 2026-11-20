import { Bot, GrammyError, InlineKeyboard, InputFile, type Context } from "grammy";
import type { MessageEntity, Update } from "grammy/types";
import type { FastifyInstance } from "fastify";
import { hydrateFiles } from "@grammyjs/files";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hash, safePath } from "./security.js";
import type { LiveEvent } from "./store.js";
import { autoRetry } from "@grammyjs/auto-retry";
import { run, sequentialize } from "@grammyjs/runner";
import type { Store } from "./store.js";
import type { Providers } from "./providers.js";
import type { Skills } from "./skills.js";
import type { Tools } from "./tools.js";
import type { Agent } from "./agent.js";
import { config } from "./config.js";
import { telegramMessages } from "./telegram-format.js";
import { approvalCard, questionCard, resolvedQuestionCard } from "./telegram-cards.js";
import { providerPresets } from "./provider-presets.js";
const help = `**PANSA · YOUR PERSONAL ASSISTANT**\n\nSend a question, idea, or task. Let's get it done.\n\n**Conversation**\n/new — Start a new session\n/stop — Stop the current task\n/status — Check status\n/tasks — Active tasks\n\n**Knowledge**\n/memory query — Search memory\n/forget fact — Forget a memory\n/skills — Available skills\n\n**Workspace**\n/dashboard — Open dashboard\n/providers — Manage AI providers\n/model — Select a model\n/permissions — View or reset session permissions\n/autoapprove on|off — Manage automatic approvals\n\nYou can also send documents, photos, and voice messages.`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const menuCommands = [
  { command: "start", description: "Open the Pansa command center" },
  { command: "model", description: "Choose a model for this session" },
  { command: "new", description: "Start a new conversation" },
  { command: "status", description: "See task status and model preference" },
  { command: "stop", description: "Stop the current task" },
  { command: "providers", description: "Manage model connections" },
  { command: "dashboard", description: "Open the web dashboard" },
  { command: "plan", description: "Create a read-only plan" },
  { command: "permissions", description: "View or reset session permissions" },
  { command: "help", description: "Browse available commands" },
];
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const barText = (frame: number, done: boolean) => {
  const width = 18;
  if (done) return "▰".repeat(width);
  const pulse = 4;
  const span = width - pulse;
  const cycle = span * 2;
  const tick = (frame * 2) % cycle;
  const start = tick <= span ? tick : cycle - tick;
  return "▱".repeat(start) + "▰".repeat(pulse) + "▱".repeat(width - start - pulse);
};
const clockFrom = (from: number) => {
  const e = Math.max(0, (Date.now() - from) / 1000);
  return `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(Math.floor(e % 60)).padStart(2, "0")}`;
};
type TelegramPromptMessage = {
  text?: string;
  caption?: string;
  entities?: MessageEntity[];
  caption_entities?: MessageEntity[];
  quote?: { text: string; entities?: MessageEntity[] };
  reply_to_message?: TelegramPromptMessage & {
    from?: { first_name: string; username?: string };
  };
};
const entityNotes = (text: string, entities: MessageEntity[] = []) =>
  entities.flatMap((entity) => {
    const value = text.slice(entity.offset, entity.offset + entity.length);
    if (!value) return [];
    switch (entity.type) {
      case "text_link":
        return [`- Hyperlink text ${JSON.stringify(value)} targets ${entity.url}`];
      case "text_mention":
        return [`- User mention ${JSON.stringify(value)} refers to ${entity.user.username ? `Telegram username ${entity.user.username}` : entity.user.first_name}`];
      case "blockquote":
      case "expandable_blockquote":
        return [`- Telegram ${entity.type === "blockquote" ? "quotation" : "expandable quotation"}: ${JSON.stringify(value)}`];
      case "bold":
      case "italic":
      case "underline":
      case "strikethrough":
      case "spoiler":
      case "code":
        return [`- Telegram ${entity.type} formatting applies to ${JSON.stringify(value)}`];
      case "pre":
        return [`- Telegram code block${entity.language ? ` (${entity.language})` : ""}: ${JSON.stringify(value)}`];
      default:
        return [];
    }
  }).slice(0, 30);
const telegramPrompt = (message: TelegramPromptMessage) => {
  const text = message.text ?? message.caption ?? "";
  const entities = message.text ? message.entities : message.caption_entities;
  const sections = [text];
  const details = entityNotes(text, entities);
  if (details.length) sections.push(`Telegram text formatting and links:\n${details.join("\n")}`);

  if (message.quote?.text) {
    const quote = message.quote;
    const quoteDetails = entityNotes(quote.text, quote.entities);
    sections.push(`Quoted excerpt from the replied-to message:\n${quote.text}${quoteDetails.length ? `\nFormatting: ${quoteDetails.join("; ")}` : ""}`);
  }
  const replied = message.reply_to_message;
  const repliedText = replied?.text ?? replied?.caption;
  if (repliedText) {
    const sender = replied?.from?.username ? `@${replied.from.username}` : replied?.from?.first_name;
    const replyEntities = replied?.text ? replied.entities : replied?.caption_entities;
    const replyDetails = entityNotes(repliedText, replyEntities);
    sections.push(`Message being replied to${sender ? ` (${sender})` : ""}:\n${repliedText}${replyDetails.length ? `\nFormatting and links: ${replyDetails.join("; ")}` : ""}`);
  }
  return sections.filter(Boolean).join("\n\n");
};
interface Deps {
  app?: FastifyInstance;
  store: Store;
  providers: Providers;
  skills: Skills;
  tools: Tools;
  agent: Agent;
}
export async function startTelegram(d: Deps) {
  const bot = new Bot(config.BOT_TOKEN);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3 }));
  bot.api.config.use(hydrateFiles(bot.token));
  bot.api.config.use((previous, method, payload, signal) => {
    if ((method === "sendMessage" || method === "editMessageText") && "text" in payload && typeof payload.text === "string" && !("entities" in payload) && !("parse_mode" in payload)) {
      const messages = telegramMessages(payload.text);
      if (messages.length === 1) Object.assign(payload, { text: messages[0]!.text, entities: messages[0]!.entities });
    }
    return previous(method, payload, signal);
  });
  const allowed = (ctx: Context) =>
    Boolean(ctx.from && config.admins.includes(ctx.from.id));
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));
  bot.use(async (ctx, next) => {
    if (allowed(ctx)) return next();
  });
  const wizardUser = (ctx: Context) => {
    if (!ctx.from) throw new Error("Sender not found");
    return ctx.from.id;
  };
  const wizard = new Map<number, string[]>();
  const wizardAdapters = new Map<number, "openai" | "responses" | "anthropic">();
  const wizardModels = new Map<number, string>();
  const questionMessages = new Map<string, Promise<{ chat: number; message: number } | undefined>[]>();
  const approvalMessages = new Map<string, { chat: number; message: number }[]>();
  const formattedEdit = async (ctx: Context, messageId: number, text: string, entities: MessageEntity[]) => {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, messageId, text, { entities, reply_markup: new InlineKeyboard() });
    } catch (error) {
      if (error instanceof GrammyError && error.description.includes("message is not modified")) return;
      if (error instanceof GrammyError && error.error_code === 400)
        await ctx.api.editMessageText(ctx.chat!.id, messageId, text, { reply_markup: new InlineKeyboard() });
      else throw error;
    }
  };
  const typeOut = async (ctx: Context, target: { message_id: number }, full: string) => {
    const chunks = telegramMessages(full);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      if (i === 0) await formattedEdit(ctx, target.message_id, chunk.text, chunk.entities);
      else await ctx.reply(chunk.text, { entities: chunk.entities });
    }
  };
  const animatedReply = async (ctx: Context, task: () => Promise<string>, label = "WORKING") => {
    const startedAt = Date.now();
    const progress = (frame: number) => `**${SPIN[frame % SPIN.length]} Pansa · ${label}**\n${barText(frame, false)}  ·  ${clockFrom(startedAt)}`;
    const msg = await ctx.reply(progress(0));
    let frame = 0,
      done = false,
      busy = false;
    const timer = setInterval(() => {
      if (done) return;
      frame++;
      if (busy) return;
      busy = true;
      ctx.api
        .editMessageText(ctx.chat!.id, msg.message_id, progress(frame))
        .catch(() => {})
        .finally(() => (busy = false));
    }, 1500);
    timer.unref?.();
    try {
      const result = await task();
      done = true;
      clearInterval(timer);
      while (busy) await sleep(30);
      await typeOut(ctx, msg, result);
      return result;
    } catch (e) {
      done = true;
      clearInterval(timer);
      while (busy) await sleep(30);
      const err = e instanceof Error ? e.message : "error";
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `⚠️ PANSA · FAILED\n${"━".repeat(18)}\n${err.slice(0, 3800)}`).catch(() => {});
      throw e;
    }
  };
  const providerName = (id: unknown) =>
    String(
      d.providers
        .list()
        .find((p) => p.id === String(id))?.name ?? "provider",
    );
  const sessionLabel = async (ctx: Context) => {
    const s = await session(ctx);
    const all = d.store.all("SELECT id FROM sessions ORDER BY rowid");
    const index = all.findIndex((x) => String(x.id) === String(s.id));
    return { s, label: `Session #${index + 1}` };
  };
  d.tools.send = async (text, file) => {
    for (const id of config.admins) {
      if (file)
        await bot.api.sendDocument(id, new InputFile(file), {
          caption: text.slice(0, 1000),
        });
      else
        for (const chunk of telegramMessages(text))
          await bot.api.sendMessage(id, chunk.text, { entities: chunk.entities });
    }
    return { ok: true };
  };
  d.store.bus.on("event", (e: LiveEvent) => {
    if (e.type === "progress" && e.data.kind === "question") {
      const keyboard = new InlineKeyboard();
      for (const [index, option] of (e.data.options as { label: string }[]).entries()) keyboard.text(`${index + 1} · ${option.label}`, `answer:${e.data.id}:${index}`).row();
      const key = String(e.data.id);
      questionMessages.set(key, config.admins.map(chat =>
        bot.api.sendMessage(chat, questionCard(e.data), { reply_markup: keyboard })
          .then(message => ({ chat, message: message.message_id }))
          .catch(() => undefined),
      ));
    }
    if (e.type === "progress" && e.data.kind === "question_resolved") {
      const key = String(e.data.id);
      const deliveries = questionMessages.get(key) ?? [];
      questionMessages.delete(key);
      for (const delivery of deliveries) void delivery.then(async sent => {
        if (!sent) return;
        if (e.data.status === "answered") {
          try {
            await bot.api.deleteMessage(sent.chat, sent.message);
            return;
          } catch {
            // Close the card visibly if Telegram cannot delete it.
          }
        }
        const card = telegramMessages(resolvedQuestionCard(e.data))[0]!;
        await bot.api.editMessageText(sent.chat, sent.message, card.text, {
          entities: card.entities,
          reply_markup: new InlineKeyboard(),
        });
      }).catch(() => {});
    }
    if (e.type === "audit" && (e.data.action === "approval" || e.data.action === "approval_closed")) {
      const key = String(e.data.id);
      for (const message of approvalMessages.get(key) ?? []) void bot.api.deleteMessage(message.chat, message.message).catch(() => bot.api.editMessageReplyMarkup(message.chat, message.message, { reply_markup: new InlineKeyboard() }).catch(() => {}));
      approvalMessages.delete(key);
    }
    if (e.type === "progress" && (e.data.kind === "todo" || (e.data.kind === "subagent" && e.data.status !== "running"))) void d.tools.send(String(e.data.text).slice(0, 1000)).catch(() => {});
    if (e.type === "approval") {
      const key = String(e.data.id);
      approvalMessages.set(key, []);
      const keyboard = new InlineKeyboard()
        .text("✅ Allow once", `approve:${e.data.id}:yes`);
      if (e.data.allowSession) keyboard.text("🔓 Allow for session", `approve:${e.data.id}:session`).row();
      keyboard.text("❌ Deny", `approve:${e.data.id}:no`);
      for (const id of config.admins)
        void bot.api
          .sendMessage(
            id,
            approvalCard(e.data),
            { reply_markup: keyboard },
          )
          .then(async message => {
            if (!d.tools.pending.has(key)) { await bot.api.deleteMessage(id, message.message_id); return; }
            approvalMessages.get(key)?.push({ chat: id, message: message.message_id });
          })
          .catch(() => {});
    }
    if (e.type === "switch") {
      const from = e.data.fromName ?? providerName(e.data.from);
      const to = e.data.toName ?? providerName(e.data.to);
      void d.tools
        .send(`🔀 Provider switch: ${String(from)} → ${String(to)}\n${e.data.reason}`)
        .catch(() => {});
    }
  });
  const session = async (ctx: Context) =>
    d.store.session(
      `Telegram ${ctx.chat?.id ?? "unknown"}`,
      ctx.chat?.id ?? null,
    );
  bot.command("start", (ctx) => ctx.reply(help, { reply_markup: new InlineKeyboard()
    .text("Choose model", "menu:model").text("Status", "menu:status").row().text("Help", "menu:help") }));
  bot.command("help", async ctx => ctx.reply((await d.agent.commands.execute(String((await session(ctx)).id), "/help"))?.response ?? help));
  bot.command("permissions", async ctx => {
    const s = await session(ctx);
    const result = await d.agent.commands.execute(String(s.id), `/permissions ${ctx.match}`.trim());
    await ctx.reply(result?.response ?? "Use /permissions or /permissions reset.");
  });
  bot.command("compact", async ctx => {
    const s = await session(ctx);
    const result = await d.agent.commands.execute(s.id, "/compact");
    if (result?.response) await ctx.reply(result.response);
  });
  const commandLabels = { mode: "Session mode", plan: "Preparing a plan", clear: "Clearing context", init: "Inspecting the project", review: "Reviewing changes", cost: "Checking usage", doctor: "Checking connections" };
  for (const [name, label] of Object.entries(commandLabels))
    bot.command(name, async ctx => {
      const s = await session(ctx);
      if (d.agent.running.has(String(s.id))) return ctx.reply("A task is still running. Use /stop first.");
      const rawPrompt = `/${name} ${ctx.match}`.trim();
      const prompt = ["mode", "clear", "cost", "doctor"].includes(name)
        ? rawPrompt
        : telegramPrompt(ctx.message as TelegramPromptMessage).replace(/^\/[\w]+(?:@[\w]+)?/, `/${name}`);
      void animatedReply(ctx, () => d.agent.run(String(s.id), prompt), label).catch(() => {});
    });
  bot.callbackQuery(/^answer:/, async ctx => {
    const [, id, index] = ctx.callbackQuery.data.split(":");
    const pending = d.tools.questions.get(id!);
    const option = pending?.options[Number(index)];
    if (!pending || option === undefined) { await ctx.answerCallbackQuery("This question is closed"); return; }
    try { d.tools.answer(id!, option); await ctx.answerCallbackQuery(`Saved: ${option}`.slice(0, 180)); }
    catch { await ctx.answerCallbackQuery("Your answer was not saved. Please try again."); }
  });
  bot.command("new", async (ctx) => {
    const old = await session(ctx);
    d.agent.stop(String(old.id));
    d.store.run("UPDATE sessions SET chat_id=NULL WHERE id=?", String(old.id));
    d.store.session("Telegram session", ctx.chat?.id ?? null);
    await ctx.reply(`Your new session is ready. Previous history is saved.`);
  });
  bot.command("continue", async (ctx) => {
    const requested = ctx.match.trim();
    if (!/^[a-f0-9-]{36}$/.test(requested)) return ctx.reply("Use /continue SESSION_ID from the dashboard or CLI session list.");
    const target = d.store.get("SELECT id FROM sessions WHERE id=?", requested);
    if (!target) return ctx.reply("Session not found.");
    const current = await session(ctx);
    d.store.run("UPDATE sessions SET chat_id=NULL WHERE id=?", String(current.id));
    d.store.run("UPDATE sessions SET chat_id=? WHERE id=?", ctx.chat?.id ?? null, requested);
    await ctx.reply(`Session ${requested} is now connected to Telegram. Your conversation context and session memory will continue.`);
  });
  bot.command("stop", async (ctx) => {
    const s = await session(ctx);
    const result = d.agent.stopOrReap(String(s.id));
    await ctx.reply(
      result === "idle"
        ? "No task is running."
        : "Task stopped.",
    );
  });
  const showStatus = async (ctx: Context) => {
    const { s, label } = await sessionLabel(ctx);
    const active = d.providers
      .list()
      .filter((p) => p.enabled)
      .map((p) => p.name);
    const preferred = d.providers.list().find(provider => provider.id === s.pinned && provider.enabled);
    await ctx.reply(`**${label}**\nStatus: ${d.agent.running.has(String(s.id)) ? "working" : "idle"}\nPreferred model: ${preferred ? `${preferred.name} · ${preferred.model}` : "Automatic"}\nActive providers: ${active.join(", ") || "none"}`);
  };
  bot.command("status", showStatus);
  const providerKeyboard = (pinned?: unknown) => {
    const list = d.providers.list();
    const keyboard = new InlineKeyboard();
    list.forEach((p, i) => {
      const mark = String(p.id) === String(pinned) ? "✅" : "📌";
      keyboard
        .text(
          `${mark} ${i + 1}. ${String(p.name).slice(0, 22)}`,
          `provider:pin:${p.id}`,
        )
        .row()
        .text("🧪 Test", `provider:test:${p.id}`)
        .text(p.enabled ? "⏸ Disable" : "▶ Enable", `provider:toggle:${p.id}`)
        .text("🗑", `provider:del:${p.id}`)
        .row();
    });
    return keyboard;
  };
  const providerList = async (ctx: Context) => {
    const s = await session(ctx);
    const list = d.providers.list();
    if (!list.length)
      return ctx.reply(
        "No providers yet. Use /addprovider or open the dashboard provider editor.",
      );
    const lines = list.map((p, i) => {
      const mark = String(p.id) === String(s.pinned) ? "✅" : "▫️";
      return `${mark} ${i + 1}. ${p.name} · ${p.model} · ${p.enabled ? "enabled" : "disabled"} · ${p.api_key}`;
    });
    return ctx.reply(
      `**AI providers**\nTap to select a connection:\n${lines.join("\n")}`,
      { reply_markup: providerKeyboard(s.pinned) },
    );
  };
  bot.command("providers", providerList);
  bot.command("addprovider", async (ctx) => {
    const parts = ctx.match.split("|");
    if (parts.length !== 4 && parts.length !== 5) {
      const user = wizardUser(ctx);
      wizard.set(user, []); wizardAdapters.delete(user); wizardModels.delete(user);
      const keyboard = new InlineKeyboard();
      providerPresets.forEach((preset, index) => { keyboard.text(preset.name, `preset:${preset.id}`); if (index % 2) keyboard.row(); });
      return ctx.reply("**Connect an AI provider**\n\nChoose a preset or enter a connection name. At the model step, send ? to discover models. Use /cancel to exit. Advanced configuration is available in the dashboard.", { reply_markup: keyboard });
    }
    await ctx.deleteMessage().catch(() => {});
    try {
      const draft = {
        name: parts[0],
        base_url: parts[1],
        api_key: parts[2],
        model: parts[3],
        priority: 0,
        adapter: parts[4] ?? "openai",
      };
      const test = await d.providers.testDraft(draft);
      d.providers.save(draft);
      await ctx.reply(`**Provider connected**\n\n${parts[0]} · ${parts[3]}\nConnection verified · ${test.latency} ms\nCredentials saved encrypted.`);
    } catch (e) {
      await ctx.reply(`Failed: ${e instanceof Error ? e.message : "error"}`);
    }
  });
  bot.command("cancel", async ctx => {
    const user = wizardUser(ctx);
    wizard.delete(user); wizardAdapters.delete(user); wizardModels.delete(user);
    await ctx.reply("Provider setup cancelled.");
  });
  const modelPicker = (pinned: unknown) => {
    const providers = d.providers.list().filter(provider => provider.enabled);
    const selected = providers.find(provider => provider.id === pinned);
    const keyboard = new InlineKeyboard().text(selected ? "Automatic" : "✓ Automatic", "model:pick:auto").row();
    for (const provider of providers.slice(0, 90)) {
      keyboard.text(`${provider.id === selected?.id ? "✓ " : ""}${provider.name} · ${provider.model}`.slice(0, 58), `model:pick:${provider.id}`).row();
    }
    const text = `**Choose a model**\n\nPreferred for the next task in this session: ${selected ? `${selected.name} · ${selected.model}` : "Automatic"}.\n\n${providers.length ? "Pick a connection below. Pansa can fall back if it is unavailable." : "Add or enable a connection in /providers first."}`;
    return { text, keyboard };
  };
  const showModel = async (ctx: Context) => {
    const { text, keyboard } = modelPicker((await session(ctx)).pinned);
    await ctx.reply(text, { reply_markup: keyboard });
  };
  bot.callbackQuery(/^menu:(model|status|help)$/, async ctx => {
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === "model") await showModel(ctx);
    else if (ctx.match[1] === "status") await showStatus(ctx);
    else await ctx.reply(help);
  });
  bot.callbackQuery(/^model:pick:(.+)$/, async ctx => {
    const key = ctx.match[1]!;
    try {
      const selected = d.providers.selectForSession((await session(ctx)).id, key === "auto" ? null : key);
      await ctx.answerCallbackQuery(selected.pinned ? "Model preference saved" : "Automatic selection enabled");
      const { text, keyboard } = modelPicker(selected.pinned);
      await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
    } catch (error) {
      await ctx.answerCallbackQuery(error instanceof Error ? error.message.slice(0, 180) : "Could not select model");
    }
  });
  bot.command("model", async (ctx) => {
    const query = ctx.match.trim();
    if (!query) {
      return showModel(ctx);
    }
    try {
      const selected = d.providers.selectForSession((await session(ctx)).id, query.toLowerCase() === "auto" ? null : query);
      const { text, keyboard } = modelPicker(selected.pinned);
      return ctx.reply(text, { reply_markup: keyboard });
    } catch (error) {
      return ctx.reply(`${error instanceof Error ? error.message : "Could not select model"}\nUse /model to open the picker.`);
    }
  });
  bot.command("skills", async (ctx) =>
    ctx.reply(
      (await d.skills.list())
        .map((s) => `• ${s.name}: ${s.description}`)
        .join("\n") || "No skills available yet.",
    ),
  );
  bot.command("memory", (ctx) =>
    ctx.reply(JSON.stringify(d.store.recall(ctx.match || "", String(d.store.session("Telegram", ctx.chat?.id ?? null).id)), null, 2).slice(0, 4000)),
  );
  bot.command("forget", async (ctx) => {
    const query = ctx.match.trim();
    if (!query) return ctx.reply("Use /forget followed by the fact you want forgotten.");
    const result = await d.tools.profile.forgetMemory(query, String((await session(ctx)).id));
    await ctx.reply(result.verified ? `Deleted ${result.deleted} memories. Index removal verified.` : "Deletion could not be verified. The memory may still exist.");
  });
  bot.command("dashboard", (ctx) => {
    const token = randomBytes(32).toString("hex");
    d.store.run(
      "INSERT INTO auth(token,expires,one_time) VALUES(?,?,1)",
      hash(token),
      Date.now() + 300000,
    );
    return ctx.reply(
      `Dashboard: ${config.PUBLIC_URL}/#login=${token}\nOne-time sign-in link. Expires in 5 minutes.`,
    );
  });
  bot.command("tasks", (ctx) =>
    ctx.reply(`Active tasks: ${d.agent.running.size}`),
  );
  bot.command("autoapprove", async (ctx) => {
    const s = await session(ctx),
      on = ctx.match.toLowerCase() === "on";
    d.store.run(
      "UPDATE sessions SET auto_approve=? WHERE id=?",
      Number(on),
      s.id,
    );
    await ctx.reply(`Auto-approve ${on ? "enabled" : "disabled"}. Protected actions still require approval.`);
  });
  for (const name of ["delprovider", "toggle", "prio", "test"] as const)
    bot.command(name, async (ctx) => {
      const [id, priority] = ctx.match.trim().split(/\s+/);
      if (!id)
        return ctx.reply(
          `Use /${name} ID${name === "prio" ? " PRIORITY" : ""}`,
        );
      try {
        if (name === "test")
          return ctx.reply(JSON.stringify(await d.providers.test(id)));
        if (name === "delprovider") {
          d.store.run("DELETE FROM providers WHERE id=?", id);
          d.providers.refreshSecrets();
        } else if (name === "toggle")
          d.store.run("UPDATE providers SET enabled=1-enabled WHERE id=?", id);
        else {
          const n = Number(priority);
          if (!Number.isInteger(n)) throw new Error("Priority must be an integer");
          d.store.run("UPDATE providers SET priority=? WHERE id=?", n, id);
        }
        return ctx.reply("Provider updated");
      } catch (e) {
        return ctx.reply(e instanceof Error ? e.message : "Failed");
      }
    });
  bot.command("logs", (ctx) =>
    ctx.reply(
      JSON.stringify(
        d.store.all(
          "SELECT * FROM events WHERE type<>? ORDER BY id DESC LIMIT 8",
          "token",
        ),
        null,
        2,
      ).slice(0, 3900),
    ),
  );
  bot.command("schedule", async (ctx) => {
    const [cron, ...rest] = ctx.match.split("|");
    if (!cron || !rest.length)
      return ctx.reply("Usage: /schedule CRON|TASK (UTC)");
    const s = await session(ctx);
    try {
      const result = await d.tools.call(
        "schedule",
        { cron, prompt: rest.join("|") },
        {
          session: String(s.id),
          signal: AbortSignal.timeout(300000),
          depth: 0,
        },
      );
      await ctx.reply(result);
    } catch (e) {
      await ctx.reply(e instanceof Error ? e.message : "Failed");
    }
  });
  bot.callbackQuery(/^preset:/, async (ctx) => {
    const name = ctx.callbackQuery.data.slice(7).toLowerCase();
    const preset = providerPresets.find(item => item.id === name || item.name.toLowerCase() === name);
    if (!preset) { await ctx.answerCallbackQuery("Preset not found"); return; }
    wizard.set(ctx.from.id, preset.id === "custom" ? [] : [preset.name, preset.base_url]);
    wizardAdapters.set(ctx.from.id, preset.adapter); wizardModels.set(ctx.from.id, preset.model);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      preset.id === "custom"
        ? "Connection name?"
        : "Enter your API key, or - if none is required. Your key message will be deleted after receipt.",
    );
  });
  bot.callbackQuery(/^approve:/, async (ctx) => {
    const [, id, decision] = ctx.callbackQuery.data.split(":");
    try {
      d.tools.decide(id!, decision === "yes" || decision === "session", decision === "session" ? "session" : "once");
      await ctx.answerCallbackQuery(
        decision === "session" ? "Allowed for this session" : decision === "yes" ? "Allowed once" : "Denied",
      );
    } catch {
      await ctx.answerCallbackQuery("Approval expired");
    }
  });
  bot.on(
    ["message:document", "message:photo", "message:voice"],
    async (ctx) => {
      const s = await session(ctx);
      const doc = ctx.message.document;
      const fileId =
        doc?.file_id ??
        ctx.message.photo?.at(-1)?.file_id ??
        ctx.message.voice?.file_id;
      if (!fileId) return;
      const root = await d.tools.sandbox.root(String(s.id));
      const file = await bot.api.getFile(fileId);
      if (Number(file.file_size) > 20e6)
        return ctx.reply("File is too large (maximum 20 MB)");
      const name = path.basename(
        doc?.file_name ??
          `upload-${Date.now()}${ctx.message.voice ? ".ogg" : ".jpg"}`,
      );
      const dest = await safePath(root, name);
      const response = await fetch(
        `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok) return ctx.reply("Telegram download failed");
      await fs.writeFile(dest, Buffer.from(await response.arrayBuffer()));
      if (name.endsWith(".md")) {
        try {
          const raw = await fs.readFile(dest, "utf8");
          const meta = await d.skills.save(raw);
          return ctx.reply(`Skill ${meta.name} installed.`);
        } catch {}
      }
      const caption = telegramPrompt(ctx.message as TelegramPromptMessage).trim();
      await ctx.reply(`File received: ${name}. I'll analyze its contents.`);
      if (!d.agent.running.has(String(s.id))) void animatedReply(ctx, () => d.agent.run(String(s.id), `${caption ? `User instructions: ${caption}\n` : ""}Analyze attachment @${name} and provide a summary, key facts, and limitations. ${ctx.message.voice ? "If no audio transcription tool is available, explain the limitation without inventing a transcript." : ""}`), "ANALYZING FILE").catch(() => {});
      else await ctx.reply("A task is running. Your file was saved and has not been analyzed yet.");
    },
  );
  bot.on("message:text", async (ctx) => {
    const fields = wizard.get(ctx.from.id);
    if (fields) {
      const value = ctx.message.text.trim();
      if (fields.length === 2) await ctx.deleteMessage().catch(() => {});
      if (fields.length === 3 && value === "?") {
        try {
          const result = await d.providers.models({ name: fields[0], base_url: fields[1], api_key: fields[2], adapter: wizardAdapters.get(ctx.from.id) ?? "openai", model: "discovery" });
          const names = result.models.slice(0, 15).map(model => `• \`${model.id.replace(/`/g, "")}\``).join("\n");
          await ctx.reply(`**Available models**\n\n${names || "No models returned. Enter a model ID manually."}\n\nSend the exact model ID to continue.${result.models.length > 15 ? " More models are available in the dashboard." : ""}`);
        } catch (error) { await ctx.reply(error instanceof Error ? error.message : "Model discovery failed. Enter a model ID manually."); }
        return;
      }
      fields.push(value === "-" ? (fields.length === 3 ? wizardModels.get(ctx.from.id) ?? "" : "") : value);
      if (fields.length < 4)
        return ctx.reply(
          [
            "Connection name?",
            "Base URL?",
            "API key? Your key message will be deleted.",
            `Model ID? Send ? to discover models${wizardModels.get(ctx.from.id) ? ` or - to use ${wizardModels.get(ctx.from.id)}` : ""}.`,
          ][fields.length] ?? "Model?",
        );
      wizard.delete(ctx.from.id);
      const adapter = wizardAdapters.get(ctx.from.id) ?? "openai";
      wizardAdapters.delete(ctx.from.id); wizardModels.delete(ctx.from.id);
      try {
        const draft = {
          name: fields[0],
          base_url: fields[1],
          api_key: fields[2],
          model: fields[3],
          adapter,
        };
        const test = await d.providers.testDraft(draft);
        d.providers.save(draft);
        await ctx.reply(
          `**Provider connected**\n\n${fields[0]} · ${fields[3]}\nConnection verified · ${test.latency} ms\nCredentials saved encrypted.`,
        );
      } catch {
        await ctx.reply(
          "Saving or testing the provider failed. Check /providers.",
        );
      }
      return;
    }
    const prompt = telegramPrompt(ctx.message as TelegramPromptMessage);
    if (/\b(sk-|gsk_|AIza)[\w-]{12,}/.test(prompt)) {
      await ctx.deleteMessage().catch(() => {});
      return ctx.reply(
        "API keys are not processed as tasks. Use /addprovider to store your key encrypted.",
      );
    }
    const s = await session(ctx);
    const pendingQuestion = [...d.tools.questions].find(([, q]) => q.session === String(s.id));
    if (pendingQuestion) {
      try { d.tools.answer(pendingQuestion[0], ctx.message.text); void ctx.react("👍").catch(() => {}); }
      catch (error) { await ctx.reply(`**PANSA · ANSWER NOT ACCEPTED**\n\n${error instanceof Error ? error.message : "Choose an option on the open question."}`); }
      return;
    }
    if (d.agent.running.has(String(s.id)))
      return ctx.reply("A task is still running. Use /stop or /new.");
    const stop = () =>
      new InlineKeyboard().text("⛔ Stop", `stop:${s.id}`);
    const startedAt = Date.now();
    const wait = await ctx.reply(`${SPIN[0]} PANSA · PREPARING\n${barText(0, false)}  ·  ${d.tools.state.mode(String(s.id)).toUpperCase()}\n\nGetting your assistant ready…`, {
      reply_markup: stop(),
    });
    void ctx.react("👀").catch(() => {});
    const typing = () =>
      void ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    typing();
    const typingTimer = setInterval(typing, 4000);
    let writing = false,
      last = 0,
      current = "Preparing your personal context",
      frame = 0,
      busy = false,
      dirty = true,
      finished = false,
      finishedStatus = "";
    let waitingFor: { kind: "approval" | "question"; id: string } | null = null;
    const steps: string[] = [];
    const render = () => {
      const u = d.agent.sessionUsage(String(s.id));
      const secs = Math.max(0, (Date.now() - startedAt) / 1000);
      const phase = finished
        ? finishedStatus === "done" ? "DONE" : "FAILED"
        : waitingFor
          ? "WAITING FOR YOU"
        : writing
          ? "WRITING A RESPONSE"
          : steps.length
            ? "PROCESSING RESULTS"
            : secs > 2
              ? "THINKING"
              : "PREPARING";
      const spinner = finished
        ? finishedStatus === "done" ? "🎉" : "⚠️"
        : SPIN[frame % SPIN.length];
      const dots = ["", "·", "••", "•••"][frame % 4];
      const title = `${spinner} PANSA · ${phase} ${dots}`;
      const bar = barText(frame, finished);
      const pct = finished ? " 100%" : " IN PROGRESS";
      const meta = `${d.tools.state.mode(String(s.id)).toUpperCase()}  ·  ${u.provider ?? "provider?"}/${u.model ?? "—"}  ·  ${clockFrom(startedAt)}  ·  ${steps.length} steps`;
      const activity = finished
        ? finishedStatus === "done"
          ? "\n✅ All steps complete"
          : `\n❌ ${current}`
        : current
          ? `\n${current}`
          : "";
      const body = `**${title}**\n${bar} · ${finished ? "Closed" : waitingFor ? "Paused" : pct.trim()}\n${meta}${activity}`;
      return body.slice(0, 3900);
    };
    const flush = async (force = false) => {
      dirty = true;
      if (busy || (!force && Date.now() - last < 1050)) return;
      dirty = false;
      busy = true;
      last = Date.now();
      await ctx.api
        .editMessageText(ctx.chat.id, wait.message_id, render(), {
          reply_markup: finished ? new InlineKeyboard() : stop(),
        })
        .catch(() => {})
        .finally(() => { busy = false; });
    };
    const settle = async () => {
      while (busy) await sleep(30);
    };
    const listener = (e: LiveEvent) => {
      if (e.type === "audit" && (e.data.action === "approval" || e.data.action === "approval_closed") && waitingFor?.id === e.data.id) {
        waitingFor = null; current = "Continuing your task"; dirty = true; return;
      }
      if (e.session_id !== s.id) return;
      if (e.type === "approval") {
        waitingFor = { kind: "approval", id: String(e.data.id) };
        current = "Review the action on the approval card below";
      } else if (e.type === "progress" && e.data.kind === "question") {
        waitingFor = { kind: "question", id: String(e.data.id) };
        current = "Choose an answer on the question card to continue";
      } else if (e.type === "progress" && e.data.kind === "question_resolved") {
        waitingFor = null; current = "Continuing with your choice";
      } else if (e.type === "token") {
        writing = true;
        current = "✍️ Composing your response";
      }
      else if (e.type === "tool") {
        writing = false;
        const name = String(e.data.name ?? e.data.tool ?? "tool");
        const activityLabels: Record<string, string> = { web_fetch: "Reading a web page", web_search: "Searching the web", http_request: "Fetching web data", bash: "Running a command", run_python: "Analyzing data", read_file: "Reading a file" };
        if (e.data.status === "running") current = `⚙️ ${activityLabels[name] ?? `Running ${name.replace(/_/g, " ")}`}`;
        else {
          const secs = Number(e.data.durationMs ?? 0);
          const exit = e.data.exitCode;
          steps.push(
            [
              e.data.status === "done" ? "✅" : "❌",
              name,
              secs >= 1000 ? `${Math.round(secs / 1000)} sec` : "",
              exit === undefined || exit === null ? "" : `exit ${String(exit)}`,
            ]
              .filter(Boolean)
              .join(" "),
          );
          current = e.data.status === "done" ? "🔎 Reviewing tool results" : "🧭 Adjusting the next step";
        }
      } else if (e.type === "progress" && e.data.kind !== "context") {
        current = `${e.data.kind === "todo" ? "📍" : e.data.kind === "subagent" ? "🧩" : "💡"} ${String(e.data.text ?? "Working").slice(0, 240)}`;
      } else if (e.type === "progress" && e.data.kind === "context" && Number(e.data.percent) >= 70) {
        current = `🧠 Managing conversation context · ~${e.data.percent}%`;
      } else return;
      dirty = true;
    };
    d.store.bus.on("event", listener);
    const animationTimer = setInterval(() => {
      frame++;
      if (dirty || Date.now() - last > 1600) void flush();
    }, 1500);
    animationTimer.unref?.();
    const reveal = async (result: string) => {
      await settle();
      await typeOut(ctx, wait, result);
    };
    void d.agent
      .run(String(s.id), prompt)
      .then(async (result) => {
        clearInterval(animationTimer);
        d.store.bus.off("event", listener);
        finished = true;
        finishedStatus = "done";
        current = "";
        void ctx.react("🎉").catch(() => {});
        await reveal(result);
      })
      .catch(async (e) => {
        finished = true;
        finishedStatus = "error";
        current = e instanceof Error ? e.message : "Task failed";
        clearInterval(animationTimer);
        writing = false;
        void ctx.react("😢").catch(() => {});
        await settle();
        await flush(true);
      })
      .finally(() => {
        clearInterval(typingTimer);
        clearInterval(animationTimer);
        d.store.bus.off("event", listener);
      });
  });
  bot.callbackQuery(/^provider:/, async (ctx) => {
    const [, action, id] = ctx.callbackQuery.data.split(":");
    if (action === "noop") return ctx.answerCallbackQuery();
    const provider = d.providers.list().find((p) => String(p.id) === id);
    if (!provider) return ctx.answerCallbackQuery("Provider not found");
    const name = String(provider.name);
    if (action === "pin") {
      const s = await session(ctx);
      if (!provider.enabled) return ctx.answerCallbackQuery("Enable this connection first");
      d.providers.selectForSession(s.id, String(provider.id));
      await ctx.answerCallbackQuery("Model preference saved for the next task");
      return ctx.editMessageReplyMarkup({
        reply_markup: providerKeyboard(provider.id),
      });
    }
    if (action === "test") {
      await ctx.answerCallbackQuery(`Testing ${name}…`);
      try {
        const r = await d.providers.test(String(provider.id));
        return ctx.reply(
          r.ok ? `✅ ${name} connected (${r.latency} ms)` : `⚠️ ${name} failed`,
        );
      } catch (e) {
        return ctx.reply(
          `❌ ${name} failed: ${e instanceof Error ? e.message : "error"}`,
        );
      }
    }
    if (action === "toggle") {
      d.store.run(
        "UPDATE providers SET enabled=1-enabled WHERE id=?",
        String(provider.id),
      );
      const now = d.providers
        .list()
        .find((p) => String(p.id) === id);
      await ctx.answerCallbackQuery(
        now?.enabled ? `${name} enabled` : `${name} disabled`,
      );
      return ctx.editMessageReplyMarkup({
        reply_markup: providerKeyboard(
          (await session(ctx)).pinned,
        ),
      });
    }
    if (action === "del") {
      await ctx.answerCallbackQuery();
      return ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard()
          .text(`🗑 Delete ${name}?`, "provider:noop")
          .row()
          .text("Yes, delete", `provider:delyes:${provider.id}`)
          .text("Cancel", `provider:delno:${provider.id}`),
      });
    }
    if (action === "delyes") {
      d.store.run("DELETE FROM providers WHERE id=?", String(provider.id));
      d.providers.refreshSecrets();
      await ctx.answerCallbackQuery(`${name} deleted`);
      return ctx.editMessageText(`🗑 Provider ${name} deleted.`);
    }
    if (action === "delno") {
      await ctx.answerCallbackQuery("Cancelled");
      return ctx.editMessageReplyMarkup({
        reply_markup: providerKeyboard((await session(ctx)).pinned),
      });
    }
    return ctx.answerCallbackQuery();
  });
  bot.callbackQuery(/^stop:/, async (ctx) => {
    const result = d.agent.stopOrReap(ctx.callbackQuery.data.slice(5));
    await ctx.answerCallbackQuery(
      result === "idle" ? "No task running" : "Task stopped",
    );
  });
  bot.catch((err) =>
    d.store.event("error", null, { error: String(err.error) }),
  );
  void bot.api.setMyCommands(menuCommands).catch(() => {
    d.store.event("health", null, { telegram: "command_menu_update_failed" });
  });
  const webhook =
    config.TELEGRAM_MODE === "webhook" ||
    (config.TELEGRAM_MODE === "auto" && config.PUBLIC_URL.startsWith("https:"));
  if (webhook && d.app) {
    await bot.init();
    const secret =
      config.WEBHOOK_SECRET || hash(config.MASTER_KEY + ":telegram");
    d.app.post(
      "/telegram/webhook",
      { bodyLimit: 1_000_000, config: { rateLimit: false } },
      async (req, reply) => {
        if (req.headers["x-telegram-bot-api-secret-token"] !== secret)
          return reply.code(403).send({ ok: false });
        await bot.handleUpdate(req.body as Update);
        return { ok: true };
      },
    );
    const apply = async () => {
      await bot.api.setWebhook(`${config.PUBLIC_URL}/telegram/webhook`, {
        secret_token: secret,
        allowed_updates: ["message", "edited_message", "callback_query"],
        drop_pending_updates: false,
      });
      d.store.event("health", null, { telegram: "webhook" });
    };
    if (d.app.server.listening) await apply();
    else d.app.addHook("onListen", async () => void apply());
    return;
  }
  await bot.api.deleteWebhook();
  const runner = run(bot);
  process.once("SIGTERM", () => void runner.stop());
  void runner
    .task()
    ?.catch((error) =>
      d.store.event("error", null, {
        error:
          error instanceof Error ? error.message : "Telegram polling failed",
      }),
    );
}

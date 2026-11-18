import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import type { Update } from "grammy/types";
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
const help = `/new session baru\n/stop hentikan task\n/status status agent\n/model ID kunci provider\n/providers daftar provider\n/addprovider nama|base_url|api_key|model\n/skills skill aktif\n/memory cari memori\n/forget ID hapus memori\n/bounty URL atau kirim brief\n/bounties daftar bounty\n/tasks task berjalan\n/dashboard link dashboard\n/autoapprove on|off`;
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
  const allowed = (ctx: Context) =>
    Boolean(ctx.from && config.admins.includes(ctx.from.id));
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));
  bot.use(async (ctx, next) => {
    if (allowed(ctx)) return next();
  });
  const wizardUser = (ctx: Context) => {
    if (!ctx.from) throw new Error("Pengirim tidak ditemukan");
    return ctx.from.id;
  };
  const wizard = new Map<number, string[]>();
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
    return { s, label: `Sesi #${index + 1}` };
  };
  d.tools.send = async (text, file) => {
    for (const id of config.admins) {
      if (file)
        await bot.api.sendDocument(id, new InputFile(file), {
          caption: text.slice(0, 1000),
        });
      else
        for (const chunk of text.match(/.{1,3900}/gs) ?? ["Selesai"])
          await bot.api.sendMessage(id, chunk);
    }
    return { ok: true };
  };
  d.store.bus.on("event", (e: LiveEvent) => {
    if (e.type === "approval") {
      const keyboard = new InlineKeyboard()
        .text("✅ Setuju", `approve:${e.data.id}:yes`)
        .text("❌ Tolak", `approve:${e.data.id}:no`);
      for (const id of config.admins)
        void bot.api
          .sendMessage(
            id,
            `Approval tool ${e.data.tool}\n${JSON.stringify(e.data.args).slice(0, 2000)}`,
            { reply_markup: keyboard },
          )
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
  bot.command("start", (ctx) => ctx.reply(`PansaOS aktif.\n\n${help}`));
  bot.command("help", (ctx) => ctx.reply(help));
  bot.command("new", async (ctx) => {
    const old = await session(ctx);
    d.agent.stop(String(old.id));
    d.store.run("UPDATE sessions SET chat_id=NULL WHERE id=?", String(old.id));
    d.store.session("Telegram session", ctx.chat?.id ?? null);
    await ctx.reply(`Sesi baru siap. Riwayat sebelumnya tetap tersimpan.`);
  });
  bot.command("stop", async (ctx) => {
    const s = await session(ctx);
    const result = d.agent.stopOrReap(String(s.id));
    await ctx.reply(
      result === "idle"
        ? "Tidak ada task yang berjalan."
        : "Task dihentikan.",
    );
  });
  bot.command("status", async (ctx) => {
    const { s, label } = await sessionLabel(ctx);
    const active = d.providers
      .list()
      .filter((p) => p.enabled)
      .map((p) => p.name);
    await ctx.reply(
      `${label}\nStatus: ${d.agent.running.has(String(s.id)) ? "bekerja" : "menganggur"}\nProvider aktif: ${active.join(", ") || "belum ada"}`,
    );
  });
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
        .text("🧪 Tes", `provider:test:${p.id}`)
        .text(p.enabled ? "⏸ Nonaktifkan" : "▶ Aktifkan", `provider:toggle:${p.id}`)
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
        "Belum ada provider. Tambahkan dengan /addprovider atau wizard.",
      );
    const lines = list.map((p, i) => {
      const mark = String(p.id) === String(s.pinned) ? "✅" : "▫️";
      return `${mark} ${i + 1}. ${p.name} · ${p.model} · ${p.enabled ? "aktif" : "off"} · ${p.api_key}`;
    });
    return ctx.reply(
      `Provider (ketuk untuk memilih):\n${lines.join("\n")}`,
      { reply_markup: providerKeyboard(s.pinned) },
    );
  };
  bot.command("providers", providerList);
  bot.command("addprovider", async (ctx) => {
    const parts = ctx.match.split("|");
    if (parts.length !== 4) {
      wizard.set(wizardUser(ctx), []);
      return ctx.reply("Pilih preset atau kirim nama provider:", {
        reply_markup: new InlineKeyboard()
          .text("OpenAI", "preset:OpenAI")
          .text("OpenRouter", "preset:OpenRouter")
          .row()
          .text("Groq", "preset:Groq")
          .text("Gemini", "preset:Gemini")
          .row()
          .text("Ollama", "preset:Ollama")
          .text("Custom", "preset:Custom"),
      });
    }
    await ctx.deleteMessage().catch(() => {});
    try {
      const id = d.providers.save({
        name: parts[0],
        base_url: parts[1],
        api_key: parts[2],
        model: parts[3],
        priority: 0,
      });
      await ctx.reply(`Provider ${parts[0]} tersimpan. Tes koneksi...`);
      const test = await d.providers.test(id);
      await ctx.reply(`Koneksi berhasil, latency ${test.latency}ms.`);
    } catch (e) {
      await ctx.reply(`Gagal: ${e instanceof Error ? e.message : "error"}`);
    }
  });
  bot.command("model", async (ctx) => {
    const s = await session(ctx);
    const query = ctx.match.trim();
    if (!query) {
      await ctx.reply("Pilih provider yang ingin dikunci:", {
        reply_markup: providerKeyboard(s.pinned),
      });
      return;
    }
    const p = d.providers
      .list()
      .find((x) => x.id === query || x.model === query);
    if (!p)
      return ctx.reply("Provider/model tidak ditemukan. Gunakan /providers");
    d.store.run("UPDATE sessions SET pinned=? WHERE id=?", String(p.id), s.id);
    return ctx.reply(
      `Model dikunci: ${p.name} · ${p.model}. Fallback tetap tersedia.`,
    );
  });
  bot.command("skills", async (ctx) =>
    ctx.reply(
      (await d.skills.list())
        .map((s) => `• ${s.name}: ${s.description}`)
        .join("\n") || "Belum ada skill.",
    ),
  );
  bot.command("memory", (ctx) =>
    ctx.reply(
      JSON.stringify(d.store.recall(ctx.match || ""), null, 2).slice(0, 4000),
    ),
  );
  bot.command("forget", async (ctx) => {
    d.store.run("DELETE FROM memory WHERE id=?", ctx.match);
    await ctx.reply("Memori dihapus jika ID valid.");
  });
  bot.command("bounties", (ctx) =>
    ctx.reply(
      d.store
        .all(
          "SELECT id,title,status,deadline FROM bounties ORDER BY created_at DESC",
        )
        .map((b, i) => `${i + 1}. ${b.title} · ${b.status}`)
        .join("\n") || "Belum ada bounty.",
    ),
  );
  bot.command("dashboard", (ctx) => {
    const token = randomBytes(32).toString("hex");
    d.store.run(
      "INSERT INTO auth(token,expires,one_time) VALUES(?,?,1)",
      hash(token),
      Date.now() + 300000,
    );
    return ctx.reply(
      `Dashboard: ${config.PUBLIC_URL}/#login=${token}\nLink sekali pakai, berlaku 5 menit.`,
    );
  });
  bot.command("tasks", (ctx) =>
    ctx.reply(`Task aktif: ${d.agent.running.size}`),
  );
  bot.command("autoapprove", async (ctx) => {
    const s = await session(ctx),
      on = ctx.match.toLowerCase() === "on";
    d.store.run(
      "UPDATE sessions SET auto_approve=? WHERE id=?",
      Number(on),
      s.id,
    );
    await ctx.reply(`Auto-approve ${on ? "aktif" : "nonaktif"}.`);
  });
  for (const name of ["delprovider", "toggle", "prio", "test"] as const)
    bot.command(name, async (ctx) => {
      const [id, priority] = ctx.match.trim().split(/\s+/);
      if (!id)
        return ctx.reply(
          `Gunakan /${name} ID${name === "prio" ? " PRIORITY" : ""}`,
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
          if (!Number.isInteger(n)) throw new Error("Priority harus integer");
          d.store.run("UPDATE providers SET priority=? WHERE id=?", n, id);
        }
        return ctx.reply("Provider diperbarui");
      } catch (e) {
        return ctx.reply(e instanceof Error ? e.message : "Gagal");
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
      return ctx.reply("Format /schedule CRON|TASK (UTC)");
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
      await ctx.reply(e instanceof Error ? e.message : "Gagal");
    }
  });
  bot.callbackQuery(/^preset:/, async (ctx) => {
    const preset = ctx.callbackQuery.data.slice(7);
    const urls: Record<string, string> = {
      OpenAI: "https://api.openai.com/v1",
      OpenRouter: "https://openrouter.ai/api/v1",
      Groq: "https://api.groq.com/openai/v1",
      Gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
      Ollama: "http://ollama:11434/v1",
    };
    wizard.set(
      ctx.from.id,
      preset === "Custom" ? [] : [preset, urls[preset] ?? ""],
    );
    await ctx.answerCallbackQuery();
    await ctx.reply(
      preset === "Custom"
        ? "Nama provider?"
        : "API key? Kirim - jika tanpa key. Pesan ini akan dihapus setelah diterima.",
    );
  });
  bot.callbackQuery(/^approve:/, async (ctx) => {
    const [, id, decision] = ctx.callbackQuery.data.split(":");
    try {
      d.tools.decide(id!, decision === "yes");
      await ctx.answerCallbackQuery(
        decision === "yes" ? "Disetujui" : "Ditolak",
      );
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    } catch {
      await ctx.answerCallbackQuery("Approval kedaluwarsa");
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
        return ctx.reply("File terlalu besar (maks 20MB)");
      const name = path.basename(
        doc?.file_name ??
          `upload-${Date.now()}${ctx.message.voice ? ".ogg" : ".jpg"}`,
      );
      const dest = await safePath(root, name);
      const response = await fetch(
        `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok) return ctx.reply("Unduhan Telegram gagal");
      await fs.writeFile(dest, Buffer.from(await response.arrayBuffer()));
      if (name.endsWith(".md")) {
        try {
          const raw = await fs.readFile(dest, "utf8");
          const meta = await d.skills.save(raw);
          return ctx.reply(`Skill ${meta.name} diinstal.`);
        } catch {}
      }
      return ctx.reply(
        `File disimpan di workspace: ${name}${ctx.message.voice ? " · transkripsi belum dikonfigurasi" : ""}`,
      );
    },
  );
  bot.command("bounty", async (ctx) => {
    const s = await session(ctx);
    const message = ctx.match.trim();
    if (!message)
      return ctx.reply("Kirim /bounty https://... atau tempel brief.");
    await ctx.reply("Bounty diterima, agent mulai bekerja.");
    void d.agent
      .run(
        String(s.id),
        `Kerjakan workflow bounty make.fun untuk input berikut: ${message}. Ambil brief bila URL nyata, buat rencana, implementasikan deliverable di workspace, jalankan test, dan siapkan paket submit. Jangan submit eksternal.`,
      )
      .then((r) => ctx.reply(r.slice(0, 4000)))
      .catch((e) =>
        ctx.reply(`Task gagal: ${e instanceof Error ? e.message : "error"}`),
      );
  });
  bot.on("message:text", async (ctx) => {
    const fields = wizard.get(ctx.from.id);
    if (fields) {
      const value = ctx.message.text.trim();
      if (fields.length === 2) await ctx.deleteMessage().catch(() => {});
      fields.push(value === "-" ? "" : value);
      if (fields.length < 4)
        return ctx.reply(
          [
            "Nama provider?",
            "Base URL?",
            "API key? Pesan key akan dihapus.",
            "Model?",
          ][fields.length] ?? "Model?",
        );
      wizard.delete(ctx.from.id);
      try {
        const id = d.providers.save({
          name: fields[0],
          base_url: fields[1],
          api_key: fields[2],
          model: fields[3],
        });
        await ctx.reply(
          `Provider tersimpan. ${JSON.stringify(await d.providers.test(id))}`,
        );
      } catch {
        await ctx.reply(
          "Provider gagal disimpan atau tes koneksi gagal. Cek /providers.",
        );
      }
      return;
    }
    if (/\b(sk-|gsk_|AIza)[\w-]{12,}/.test(ctx.message.text)) {
      await ctx.deleteMessage().catch(() => {});
      return ctx.reply(
        "Key tidak diproses sebagai task. Gunakan /addprovider agar tersimpan terenkripsi.",
      );
    }
    const s = await session(ctx);
    if (d.agent.running.has(String(s.id)))
      return ctx.reply("Task masih berjalan. Gunakan /stop atau /new.");
    const stop = () =>
      new InlineKeyboard().text("⛔ Stop", `stop:${s.id}`);
    const wait = await ctx.reply("⏳ Agent berpikir…", {
      reply_markup: stop(),
    });
    const typing = () =>
      void ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    typing();
    const typingTimer = setInterval(typing, 4000);
    let text = "",
      last = 0,
      current = "",
      busy = false;
    const steps: string[] = [];
    const render = () => {
      const body = [steps.slice(-4).join("\n"), current, text.trim()]
        .filter(Boolean)
        .join("\n\n");
      return body.slice(-3900) || "⏳ Agent berpikir…";
    };
    const flush = () => {
      if (busy) return;
      busy = true;
      last = Date.now();
      void ctx.api
        .editMessageText(ctx.chat.id, wait.message_id, render(), {
          reply_markup: stop(),
        })
        .catch(() => {})
        .finally(() => (busy = false));
    };
    const listener = (e: LiveEvent) => {
      if (e.session_id !== s.id) return;
      if (e.type === "token") text += String(e.data.text ?? "");
      else if (e.type === "tool") {
        const cmd = e.data.command
          ? `$ ${String(e.data.command).slice(0, 120)}`
          : String(e.data.name);
        if (e.data.status === "running") current = `💻 ${cmd}`;
        else {
          const secs = Number(e.data.durationMs ?? 0);
          const exit = e.data.exitCode;
          steps.push(
            [
              e.data.status === "done" ? "✓" : "✗",
              cmd,
              secs >= 1000 ? `(${Math.round(secs / 1000)} dtk)` : "",
              exit === undefined || exit === null ? "" : `exit ${String(exit)}`,
            ]
              .filter(Boolean)
              .join(" "),
          );
          current = "";
        }
      } else return;
      if (Date.now() - last > 1100) flush();
    };
    d.store.bus.on("event", listener);
    void d.agent
      .run(String(s.id), ctx.message.text)
      .then(async (result) => {
        for (const chunk of result.match(/.{1,3900}/gs) ?? ["Selesai"])
          await ctx.reply(chunk);
        await ctx.api
          .deleteMessage(ctx.chat.id, wait.message_id)
          .catch(() => {});
      })
      .catch((e) =>
        ctx.reply(`Gagal: ${e instanceof Error ? e.message : "error"}`),
      )
      .finally(() => {
        clearInterval(typingTimer);
        d.store.bus.off("event", listener);
      });
  });
  bot.callbackQuery(/^provider:/, async (ctx) => {
    const [, action, id] = ctx.callbackQuery.data.split(":");
    if (action === "noop") return ctx.answerCallbackQuery();
    const provider = d.providers.list().find((p) => String(p.id) === id);
    if (!provider) return ctx.answerCallbackQuery("Provider tidak ditemukan");
    const name = String(provider.name);
    if (action === "pin") {
      const s = await session(ctx);
      d.store.run(
        "UPDATE sessions SET pinned=? WHERE id=?",
        String(provider.id),
        s.id,
      );
      await ctx.answerCallbackQuery(`Dikunci ke ${name}`);
      return ctx.editMessageReplyMarkup({
        reply_markup: providerKeyboard(provider.id),
      });
    }
    if (action === "test") {
      await ctx.answerCallbackQuery(`Menguji ${name}…`);
      try {
        const r = await d.providers.test(String(provider.id));
        return ctx.reply(
          r.ok ? `✅ ${name} responsif (${r.latency} ms)` : `⚠️ ${name} gagal`,
        );
      } catch (e) {
        return ctx.reply(
          `❌ ${name} gagal: ${e instanceof Error ? e.message : "error"}`,
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
        now?.enabled ? `${name} diaktifkan` : `${name} dinonaktifkan`,
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
          .text(`🗑 Hapus ${name}?`, "provider:noop")
          .row()
          .text("Ya, hapus", `provider:delyes:${provider.id}`)
          .text("Batal", `provider:delno:${provider.id}`),
      });
    }
    if (action === "delyes") {
      d.store.run("DELETE FROM providers WHERE id=?", String(provider.id));
      d.providers.refreshSecrets();
      await ctx.answerCallbackQuery(`${name} dihapus`);
      return ctx.editMessageText(`🗑 Provider ${name} dihapus.`);
    }
    if (action === "delno") {
      await ctx.answerCallbackQuery("Dibatalkan");
      return ctx.editMessageReplyMarkup({
        reply_markup: providerKeyboard((await session(ctx)).pinned),
      });
    }
    return ctx.answerCallbackQuery();
  });
  bot.callbackQuery(/^stop:/, async (ctx) => {
    const result = d.agent.stopOrReap(ctx.callbackQuery.data.slice(5));
    await ctx.answerCallbackQuery(
      result === "idle" ? "Tidak ada task berjalan" : "Task dihentikan",
    );
  });
  bot.catch((err) =>
    d.store.event("error", null, { error: String(err.error) }),
  );
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
          error instanceof Error ? error.message : "Telegram polling gagal",
      }),
    );
}

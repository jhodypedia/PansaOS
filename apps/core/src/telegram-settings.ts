import { Bot, GrammyError } from "grammy";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Store } from "./store.js";
import { decrypt, encrypt } from "./security.js";

const settingsKey = "telegram:connection";
const tokenSchema = z.string().trim().max(256).regex(/^\d{5,}:[A-Za-z0-9_-]{20,}$/, "Enter a valid Telegram bot token from BotFather");
const idSchema = z.string().regex(/^\d+$/, "Admin IDs must be positive numeric Telegram user IDs").refine(value => Number.isSafeInteger(Number(value)) && Number(value) > 0, "Enter a valid Telegram user ID");
const adminIdsSchema = z.union([z.string().max(4000), z.array(z.string()).max(100)])
  .transform(value => typeof value === "string" ? value.trim().split(/[\s,]+/).filter(Boolean) : value)
  .pipe(z.array(idSchema).max(100))
  .transform(values => [...new Set(values.map(Number))]);
const inputSchema = z.object({
  bot_token: z.string().trim().max(256).optional(),
  admin_ids: adminIdsSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();
const identitySchema = z.object({ id: z.number().int().positive(), username: z.string().regex(/^[A-Za-z0-9_]+$/), name: z.string().max(256) });
const savedSchema = z.object({
  token: z.union([tokenSchema, z.literal("")]),
  adminIds: z.array(z.number().int().positive().safe()).max(100),
  enabled: z.boolean(),
  identity: identitySchema.optional(),
});
type Connection = z.infer<typeof savedSchema>;
type Identity = z.infer<typeof identitySchema>;
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

async function verifyBot(token: string): Promise<Identity> {
  try {
    const bot = new Bot(token, { client: { timeoutSeconds: 15 } });
    const user = await bot.api.getMe();
    if (!user.is_bot || !user.username) throw new Error("Invalid bot identity");
    return identitySchema.parse({ id: user.id, username: user.username, name: user.first_name });
  } catch (error) {
    // Telegram errors can contain the request URL and token. Do not return them.
    if (error instanceof GrammyError && [401, 404].includes(error.error_code))
      throw badRequest("Telegram rejected this bot token. Check the token in BotFather and try again.");
    throw badRequest("Could not verify the bot with Telegram. Check the token and server connectivity, then try again.");
  }
}

export class TelegramSettings {
  private readonly initial: Connection;
  private started = false;
  constructor(private store: Store, private master: string, private fallback: { token: string; adminIds: number[] }, private verify = verifyBot) {
    this.initial = this.connection();
    this.store.protectSecrets(fallback.token, this.initial.token);
  }
  connection(): Connection {
    const saved = this.store.setting(settingsKey, "");
    if (saved) return savedSchema.parse(JSON.parse(decrypt(saved, this.master)));
    return { token: this.fallback.token, adminIds: [...this.fallback.adminIds], enabled: Boolean(this.fallback.token) };
  }
  markStarted() { this.started = true; }
  status() {
    const current = this.connection();
    const signature = (value: Connection) => JSON.stringify({ token: value.enabled ? value.token : "", admins: [...value.adminIds].sort((a, b) => a - b) });
    return {
      configured: Boolean(current.token),
      enabled: current.enabled,
      admin_ids: current.adminIds.map(String),
      bot: current.identity ?? null,
      running: this.started && this.initial.enabled && Boolean(this.initial.token),
      restart_required: signature(current) !== signature(this.initial),
      source: this.store.setting(settingsKey, "") ? "dashboard" : "environment",
    };
  }
  private candidate(input: unknown) {
    const current = this.connection();
    const parsed = inputSchema.parse(input);
    const token = parsed.bot_token || current.token;
    if (token) tokenSchema.parse(token);
    return {
      token,
      adminIds: parsed.admin_ids ?? current.adminIds,
      enabled: parsed.enabled ?? current.enabled,
      identity: token === current.token ? current.identity : undefined,
    };
  }
  async test(input: unknown) {
    const candidate = this.candidate(input);
    if (!candidate.token) throw badRequest("Enter a bot token from BotFather first.");
    return { ok: true, bot: await this.verify(candidate.token) };
  }
  async save(input: unknown) {
    const candidate = this.candidate(input);
    if (candidate.enabled && !candidate.token) throw badRequest("Enter a bot token before enabling Telegram.");
    if (candidate.enabled && !candidate.adminIds.length) throw badRequest("Add at least one admin user ID before enabling Telegram.");
    if (candidate.enabled) candidate.identity = await this.verify(candidate.token);
    this.store.protectSecrets(candidate.token);
    this.store.set(settingsKey, encrypt(JSON.stringify(savedSchema.parse(candidate)), this.master));
    this.store.event("audit", null, { action: "telegram_settings_saved", enabled: candidate.enabled, adminCount: candidate.adminIds.length });
    return { ok: true, ...this.status() };
  }
}

export function telegramSettingsRoutes(app: FastifyInstance, settings: TelegramSettings) {
  app.get("/api/settings/telegram", async () => settings.status());
  app.post("/api/settings/telegram/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async req => settings.test(req.body));
  app.put("/api/settings/telegram", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async req => settings.save(req.body));
}

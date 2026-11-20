import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { z } from "zod";
import { Store } from "./store.js";
import { Providers } from "./providers.js";
import { decrypt } from "./security.js";
import { TelegramSettings, telegramSettingsRoutes } from "./telegram-settings.js";

const master = "a".repeat(64);
const token = "123456789:example_test_bot_token_abcdefghijklmnopqrstuvwxyz";
const replacement = "987654321:replacement_test_bot_token_abcdefghijklmnopqrstuvwxyz";
const identity = { id: 123456789, username: "pansa_preview_bot", name: "Pansa preview" };

function setup(fallback = { token: "", adminIds: [] as number[] }) {
  const store = new Store(":memory:");
  const verify = vi.fn(async (_token: string) => identity);
  const settings = new TelegramSettings(store, master, fallback, verify);
  return { store, verify, settings };
}

describe("Telegram dashboard setup", () => {
  it("supports existing environment configuration without exposing the token", () => {
    const h = setup({ token, adminIds: [123456] });
    try {
      h.settings.markStarted();
      expect(h.settings.status()).toMatchObject({ configured: true, enabled: true, running: true, restart_required: false, admin_ids: ["123456"], source: "environment" });
      expect(JSON.stringify(h.settings.status())).not.toContain(token);
      expect(h.store.secrets).toContain(token);
    } finally { h.store.db.close(); }
  });

  it("verifies and stores the bot encrypted, normalizes admins, and requires restart", async () => {
    const h = setup();
    try {
      const result = await h.settings.save({ bot_token: token, admin_ids: "123456, 234567\n123456", enabled: true });
      expect(h.verify).toHaveBeenCalledWith(token);
      expect(result).toMatchObject({ configured: true, enabled: true, restart_required: true, admin_ids: ["123456", "234567"], bot: identity, running: false });
      const saved = h.store.setting("telegram:connection");
      expect(saved).not.toContain(token);
      expect(JSON.parse(decrypt(saved, master)).token).toBe(token);
      expect(JSON.stringify(result)).not.toContain(token);
      const events = h.store.all("SELECT data FROM events");
      expect(JSON.stringify(events)).not.toContain(token);
      expect(h.store.event("error", null, { error: `Request failed for ${token}` }).data.error).not.toContain(token);
      const restarted = new TelegramSettings(h.store, master, { token: "", adminIds: [] }, h.verify);
      restarted.markStarted();
      expect(restarted.status()).toMatchObject({ running: true, restart_required: false });
      expect(restarted.connection()).toMatchObject({ token, adminIds: [123456, 234567] });
    } finally { h.store.db.close(); }
  });

  it("keeps the saved token when left blank, without changing the currently running config", async () => {
    const h = setup({ token, adminIds: [123456] });
    try {
      h.settings.markStarted();
      await h.settings.save({ bot_token: "", admin_ids: "345678", enabled: true });
      expect(h.verify).toHaveBeenCalledWith(token);
      expect(h.settings.status()).toMatchObject({ admin_ids: ["345678"], running: true, restart_required: true });
      expect(h.settings.connection().token).toBe(token);
      await h.settings.save({ bot_token: replacement, admin_ids: "345678", enabled: true });
      expect(h.settings.connection().token).toBe(replacement);
      expect(h.store.protectedSecrets).toEqual(expect.arrayContaining([token, replacement]));
    } finally { h.store.db.close(); }
  });

  it("tests a draft without saving or changing admin access", async () => {
    const h = setup({ token, adminIds: [123456] });
    try {
      const result = await h.settings.test({ bot_token: replacement });
      expect(result).toEqual({ ok: true, bot: identity });
      expect(h.settings.connection().token).toBe(token);
      expect(h.settings.connection().adminIds).toEqual([123456]);
      expect(h.store.setting("telegram:connection", "")).toBe("");
    } finally { h.store.db.close(); }
  });

  it("rejects invalid tokens and admin IDs without writing settings", async () => {
    const h = setup();
    try {
      for (const input of [
        { bot_token: "bad-token", admin_ids: "123456", enabled: true },
        { bot_token: token, admin_ids: "@someone", enabled: true },
        { bot_token: token, admin_ids: "-100123456789", enabled: true },
        { bot_token: token, admin_ids: "9007199254740992", enabled: true },
        { bot_token: token, admin_ids: "0", enabled: true },
        { bot_token: token, admin_ids: "", enabled: true },
        { admin_ids: "123456", enabled: true },
      ]) await expect(h.settings.save(input)).rejects.toThrow();
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.store.setting("telegram:connection", "")).toBe("");
    } finally { h.store.db.close(); }
  });

  it("retains the prior connection when Telegram verification fails", async () => {
    const h = setup({ token, adminIds: [123456] });
    try {
      h.verify.mockRejectedValueOnce(new Error("Verification unavailable"));
      await expect(h.settings.save({ bot_token: replacement, admin_ids: "234567", enabled: true })).rejects.toThrow();
      expect(h.settings.connection()).toMatchObject({ token, adminIds: [123456] });
      expect(h.store.setting("telegram:connection", "")).toBe("");
    } finally { h.store.db.close(); }
  });

  it("can disable Telegram without a token-verification request", async () => {
    const h = setup({ token, adminIds: [123456] });
    try {
      await h.settings.save({ enabled: false });
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.settings.status()).toMatchObject({ configured: true, enabled: false, restart_required: true });
      const restart = new TelegramSettings(h.store, master, { token, adminIds: [123456] }, h.verify);
      expect(restart.connection().enabled).toBe(false);
      expect(restart.status().restart_required).toBe(false);
    } finally { h.store.db.close(); }
  });

  it("keeps bot-token redaction after providers refresh their secrets", async () => {
    const h = setup({ token, adminIds: [123456] });
    try {
      const providers = new Providers(h.store, master);
      await h.settings.save({ bot_token: replacement, admin_ids: "123456", enabled: true });
      providers.refreshSecrets();
      expect(h.store.secrets).toEqual(expect.arrayContaining([token, replacement]));
      expect(h.store.event("error", null, { error: replacement }).data.error).toBe("[REDACTED]");
    } finally { h.store.db.close(); }
  });

  it("exposes masked settings and validation through native API routes", async () => {
    const h = setup();
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500).send({ error: "Invalid Telegram settings" }));
    telegramSettingsRoutes(app, h.settings);
    try {
      const saved = await app.inject({ method: "PUT", url: "/api/settings/telegram", payload: { bot_token: token, admin_ids: "123456", enabled: true } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ ok: true, restart_required: true });
      const response = await app.inject({ method: "GET", url: "/api/settings/telegram" });
      expect(response.body).not.toContain(token);
      const invalid = await app.inject({ method: "PUT", url: "/api/settings/telegram", payload: { bot_token: token, admin_ids: "@invalid", enabled: true } });
      expect(invalid.statusCode).toBe(400);
    } finally { await app.close(); h.store.db.close(); }
  });
});

import { describe, expect, it } from "vitest";
import { notificationChannel, shouldNotifyTelegram } from "./telegram-routing.js";

describe("Telegram notification routing", () => {
  it("suppresses Telegram notifications for browser-originated work", () => {
    expect(shouldNotifyTelegram("browser")).toBe(false);
  });

  it("allows notifications for Telegram, scheduled, and local work", () => {
    expect(shouldNotifyTelegram("telegram")).toBe(true);
    expect(shouldNotifyTelegram("schedule")).toBe(true);
    expect(shouldNotifyTelegram("local")).toBe(true);
  });

  it("keeps browser-originated sessions silent even when a scheduled task uses them", () => {
    expect(notificationChannel("browser", "schedule")).toBe("browser");
    expect(shouldNotifyTelegram(notificationChannel("browser", "schedule"))).toBe(false);
    expect(notificationChannel("telegram", "schedule")).toBe("schedule");
  });
});

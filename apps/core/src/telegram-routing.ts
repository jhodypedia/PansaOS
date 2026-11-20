export function shouldNotifyTelegram(channel: string): boolean {
  return channel !== "browser";
}

export function notificationChannel(persisted: string, active: string | undefined): string {
  if (persisted === "browser" || active === "browser") return "browser";
  return active || persisted || "local";
}

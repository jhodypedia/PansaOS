import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

export function installSummary(settings, showToken, serviceStarted) {
  const port = settings.DASHBOARD_PORT || "3000";
  const url = new URL(settings.PUBLIC_URL || `http://localhost:${port}`);
  url.hash = "";
  const lines = [
    "",
    "PansaOS dashboard",
    `  Address: ${url.href}`,
  ];
  if (serviceStarted) lines.push("  Service: started");
  else lines.push("  Start:   pansa serve");

  if (showToken && settings.DASH_TOKEN) {
    lines.push(
      `  Token:   ${settings.DASH_TOKEN}`,
      "",
      "Open the dashboard and paste this token to sign in.",
      "Keep it private: it grants administrator access.",
    );
  } else {
    lines.push("", "Your existing login token is unchanged.");
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    lines.push("For remote access, set PUBLIC_URL to your dashboard's HTTPS address and configure your reverse proxy.");
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const settings = parseEnv(readFileSync(process.argv[2], "utf8"));
  console.log(installSummary(settings, process.argv[3] === "true", process.argv[4] === "true"));
  console.log(`Settings: ${process.argv[2]}`);
}

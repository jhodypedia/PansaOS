import { test } from "node:test";
import assert from "node:assert/strict";
import { installSummary } from "./install-summary.mjs";

const settings = { PUBLIC_URL: "https://assistant.example", DASH_TOKEN: "example-test-token", MASTER_KEY: "do-not-display-master-key" };

test("first installation displays the dashboard address and generated login token", () => {
  const text = installSummary(settings, true, false);
  assert.match(text, /Address: https:\/\/assistant.example\//);
  assert.match(text, /Token:   example-test-token/);
  assert.match(text, /Start:   pansa serve/);
  assert.ok(!text.includes(settings.MASTER_KEY));
});

test("updates keep the existing login token out of terminal output", () => {
  const text = installSummary(settings, false, true);
  assert.ok(!text.includes(settings.DASH_TOKEN));
  assert.match(text, /existing login token is unchanged/);
  assert.match(text, /Service: started/);
  assert.ok(!text.includes("Start:"));
});

test("local dashboard fallback uses the configured port", () => {
  const text = installSummary({ DASHBOARD_PORT: "3400", DASH_TOKEN: "test-token" }, true, false);
  assert.match(text, /http:\/\/localhost:3400\//);
  assert.match(text, /For remote access/);
});

test("a configured public address is preserved without stale sign-in fragments", () => {
  const text = installSummary({ ...settings, PUBLIC_URL: "https://assistant.example:3443/#login=old-token" }, false, true);
  assert.match(text, /https:\/\/assistant.example:3443\//);
  assert.ok(!text.includes("old-token"));
  assert.ok(!text.includes("For remote access"));
});

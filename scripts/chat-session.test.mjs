import assert from "node:assert/strict";
import { test } from "node:test";
import { chatSessionKey, mergeChatEvents, readChatSession, rememberChatSession, restoreChatSession } from "../apps/dashboard/app/chat-session.ts";

const first = "5f62a371-2b4d-4148-b5cf-1b99cb9d8f35";
const second = "7496a339-a52c-4531-8164-16ee526aef61";
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

test("reload preserves this tab's choice even after another tab opens a different session", () => {
  const tab = storage(), otherTab = storage(), browser = storage();
  rememberChatSession(first, tab, browser);
  rememberChatSession(second, otherTab, browser);
  assert.equal(readChatSession(tab, browser), first);
  assert.equal(readChatSession(storage(), browser), second);
  rememberChatSession("", tab, browser);
  assert.equal(readChatSession(tab, browser), "");
  assert.equal(readChatSession(otherTab, browser), second);
});

test("an unavailable saved session is not treated as a new discussion", () => {
  const tab = storage(), browser = storage();
  tab.setItem(chatSessionKey, "invalid");
  browser.setItem(chatSessionKey, first);
  assert.deepEqual(restoreChatSession(readChatSession(tab, browser), [{ id: second }]), { id: first, missing: true });
  assert.deepEqual(restoreChatSession(first, [{ id: first }]), { id: first, missing: false });
});

test("activity refresh preserves selected history and removes duplicate events and stream tokens", () => {
  const initial = [{ id: 1, session_id: first, type: "message" }];
  const traffic = Array.from({ length: 900 }, (_, i) => ({ id: i + 2, session_id: second, type: "message" }));
  const rows = mergeChatEvents(initial, [...traffic, initial[0], { id: 902, session_id: first, type: "token" }], first);
  assert.equal(rows.filter(row => row.id === 1).length, 1);
  assert.equal(rows.length, 301);
  assert.ok(rows.every(row => row.type !== "token"));
});

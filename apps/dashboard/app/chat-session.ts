type StorageAccess = Pick<Storage, "getItem" | "setItem">;
export const chatSessionKey = "pansa-chat-session";
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function readChatSession(tab: StorageAccess, browser: StorageAccess): string {
  for (const storage of [tab, browser]) {
    try {
      const value = storage.getItem(chatSessionKey);
      if (value === "" || (value && validId.test(value))) return value;
    } catch { /* Chat still works when browser storage is unavailable. */ }
  }
  return "";
}

export function rememberChatSession(id: string, tab: StorageAccess, browser: StorageAccess) {
  for (const storage of [tab, browser]) {
    try { storage.setItem(chatSessionKey, id); } catch { /* Keep the in-memory selection. */ }
  }
}

export function restoreChatSession(id: string, sessions: Record<string, unknown>[]) {
  return { id, missing: Boolean(id) && !sessions.some(session => session.id === id) };
}

export function mergeChatEvents(previous: Record<string, unknown>[], incoming: Record<string, unknown>[], selected: string) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of [...previous, ...incoming]) if (row.type !== "token") rows.set(String(row.id), row);
  const ordered = [...rows.values()].sort((a, b) => Number(b.id) - Number(a.id));
  // Keep selected-session history independently of traffic from other sessions.
  const own = ordered.filter(row => row.session_id === selected).slice(0, 600);
  const other = ordered.filter(row => row.session_id !== selected).slice(0, 300);
  return [...own, ...other].sort((a, b) => Number(b.id) - Number(a.id));
}

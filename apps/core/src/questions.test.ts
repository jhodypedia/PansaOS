import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sandbox } from "./sandbox.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function harness() {
  vi.stubEnv("MASTER_KEY", "a".repeat(64));
  vi.stubEnv("DASH_TOKEN", "question-test-dashboard-token-12345");
  const { Store } = await import("./store.js");
  const { Tools } = await import("./tools.js");
  const { Skills } = await import("./skills.js");
  const store = new Store(":memory:");
  const tools = new Tools(store, {} as Sandbox, new Skills());
  const session = store.session().id;
  const controller = new AbortController();
  const wait = { hold: vi.fn(), release: vi.fn() };
  tools.humanWait.set(session, wait);
  const ask = (extra: Record<string, unknown> = {}) => tools.registry.get("ask_question")!.run({ question: "Pilih desain", options: [{ label: "A", description: "Pilihan pertama" }, { label: "B", description: "Pilihan kedua" }], allow_free: false, ...extra }, { session, signal: controller.signal, depth: 0 });
  const resolved = () => store.all("SELECT data FROM events WHERE type='progress'").map(row => JSON.parse(String(row.data))).filter(row => row.kind === "question_resolved");
  return { store, tools, controller, ask, resolved, wait };
}

describe("human question lifecycle", () => {
  it("keeps invalid answers pending and closes the card after a valid choice", async () => {
    const h = await harness();
    try {
      const task = h.ask();
      const id = [...h.tools.questions.keys()][0]!;
      expect(() => h.tools.answer(id, "other")).toThrow("Pilih jawaban");
      expect(h.tools.questions.has(id)).toBe(true);
      h.tools.answer(id, "A");
      await expect(task).resolves.toMatchObject({ answer: "A" });
      expect(h.resolved()).toMatchObject([{ status: "answered", answer: "A" }]);
      expect(h.tools.questions.size).toBe(0);
      expect(h.wait.release).toHaveBeenCalledOnce();
      expect(() => h.tools.answer(id, "B")).toThrow("kedaluwarsa");
    } finally { h.store.db.close(); }
  });
  it("marks a declared timeout default without claiming it was a user click", async () => {
    const h = await harness();
    vi.useFakeTimers();
    try {
      const task = h.ask({ default: "B" });
      await vi.advanceTimersByTimeAsync(300000);
      await expect(task).resolves.toMatchObject({ answer: "B" });
      expect(h.resolved()).toMatchObject([{ status: "default", answer: "B" }]);
    } finally { h.store.db.close(); }
  });
  it("closes a cancelled question and releases the task wait budget", async () => {
    const h = await harness();
    try {
      const task = h.ask();
      const rejected = expect(task).rejects.toThrow("dibatalkan");
      h.controller.abort();
      await rejected;
      expect(h.resolved()).toMatchObject([{ status: "cancelled" }]);
      expect(h.tools.questions.size).toBe(0);
      expect(h.wait.release).toHaveBeenCalledOnce();
    } finally { h.store.db.close(); }
  });
});

import { describe, expect, it } from "vitest";
import { approvalCard, questionCard, resolvedQuestionCard } from "./telegram-cards.js";
import { telegramMessages } from "./telegram-format.js";

describe("Telegram interaction cards", () => {
  it("shows option descriptions, a declared default, and free-answer guidance", () => {
    const text = telegramMessages(questionCard({ question: "Pilih arah desain?", options: [{ label: "Jade", description: "Tenang dan elegan" }, { label: "Light", description: "Terang dan bersih" }], allow_free: true, default: "Jade" }))[0]!.text;
    expect(text).toContain("1. Jade");
    expect(text).toContain("Tenang dan elegan");
    expect(text).toContain("your own answer");
    expect(text).toContain("automatically selects Jade");
  });
  it("keeps question and option text literal and states when free answers are disabled", () => {
    const text = telegramMessages(questionCard({ question: "Apakah **ini** cocok?", options: [{ label: "a_b", description: "Pilih `kode`" }, { label: "Tidak" }], allow_free: false }))[0]!.text;
    expect(text).toContain("**ini**");
    expect(text).toContain("a_b");
    expect(text).not.toContain("your own answer");
    expect(text).toContain("task stops");
  });
  it("renders commands as code and reflects resolved question states", () => {
    const card = telegramMessages(approvalCard({ tool: "bash", args: { command: "printf 'hello'" } }))[0]!;
    expect(card.entities.some(entity => entity.type === "pre")).toBe(true);
    expect(card.text).toContain("printf 'hello'");
    expect(resolvedQuestionCard({ question: "Pilih?", status: "default", answer: "A" })).toContain("DEFAULT SELECTED");
    expect(resolvedQuestionCard({ question: "Pilih?", status: "expired" })).toContain("TIMED OUT");
  });
});

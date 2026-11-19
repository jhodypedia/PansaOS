const literal = (value: unknown) => String(value ?? "").replace(/[\\`*_{}\[\]()#+\-.!>~|]/g, "\\$&");

export function questionCard(data: Record<string, unknown>) {
  const options = data.options as { label: string; description?: string }[];
  return [
    "**PANSA · PILIHAN ANDA**",
    literal(data.question),
    options.map((option, index) => `**${index + 1}. ${literal(option.label)}**${option.description ? `\n${literal(option.description)}` : ""}`).join("\n\n"),
    data.allow_free !== false ? "Ketuk pilihan di bawah, atau balas pesan ini dengan jawaban Anda sendiri." : "Ketuk salah satu pilihan di bawah untuk melanjutkan.",
    data.default ? `⏱ Batas waktu 5 menit · otomatis memilih **${literal(data.default)}**.` : "⏱ Batas waktu 5 menit · task dihentikan jika belum ada jawaban.",
  ].join("\n\n");
}

export function resolvedQuestionCard(data: Record<string, unknown>) {
  const status = data.status === "answered" ? "JAWABAN TERSIMPAN" : data.status === "default" ? "PILIHAN OTOMATIS" : data.status === "cancelled" ? "DIBATALKAN" : "WAKTU HABIS";
  const answer = String(data.answer ?? "");
  const preview = answer.length > 1800 ? `${answer.slice(0, 1800)}…` : answer;
  return [`**PANSA · ${status}**`, literal(data.question), preview ? `Pilihan: **${literal(preview)}**` : "Pertanyaan ini sudah ditutup."].join("\n\n");
}

export function approvalCard(data: Record<string, unknown>) {
  const args = data.args as Record<string, unknown> | undefined;
  const content = args?.command ? String(args.command) : JSON.stringify(args ?? {}, null, 2);
  const fence = "`".repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map(run => run.length + 1)));
  return `**PANSA · PERLU PERSETUJUAN**\n\nTool: **${literal(data.tool)}**\n\n${fence}\n${content.slice(0, 2200)}\n${fence}\n\nSetujui untuk menjalankan tindakan ini, atau tolak untuk membatalkannya.\n⏱ Berlaku selama 5 menit.`;
}

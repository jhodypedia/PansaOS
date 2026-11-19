import MarkdownIt from "markdown-it";
import { load } from "cheerio";
import type { MessageEntity } from "grammy/types";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable("image");
markdown.inline.ruler.before("text", "telegram_markup", (state, silent) => {
  const marker = state.src.slice(state.pos, state.pos + 2);
  if (marker !== "++") return false;
  const end = state.src.indexOf(marker, state.pos + 2);
  if (end <= state.pos + 2 || end + 2 > state.posMax) return false;
  if (!silent) {
    const tag = "u";
    state.push("telegram_markup_open", tag, 1);
    state.md.inline.parse(state.src.slice(state.pos + 2, end), state.md, state.env, state.tokens);
    state.push("telegram_markup_close", tag, -1);
  }
  state.pos = end + 2;
  return true;
});

export function telegramHtml(text: string) {
  return markdown.render(text)
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<h[1-6][^>]*>/g, "<b>")
    .replace(/<\/h[1-6]>/g, "</b>\n\n")
    .replace(/<strong>/g, "<b>")
    .replace(/<\/strong>/g, "</b>")
    .replace(/<em>/g, "<i>")
    .replace(/<\/em>/g, "</i>")
    .replace(/<del>/g, "<s>")
    .replace(/<\/del>/g, "</s>")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<ul>|<ol(?: [^>]*)?>|<\/ul>|<\/ol>/g, "")
    .replace(/<li>/g, "• ")
    .replace(/<\/li>/g, "\n")
    .replace(/<hr\s*\/?>/g, "────────\n\n")
    .trim();
}

export function telegramMessages(markdownText: string, limit = 3600): { text: string; entities: MessageEntity[] }[] {
  const $ = load(telegramHtml(markdownText), {}, false);
  let text = "";
  const entities: MessageEntity[] = [];
  const walk = (nodes: ReturnType<ReturnType<typeof $.root>["contents"]>, quoted = false) => {
    nodes.each((_index, node) => {
      if (node.type === "text") { text += node.data; return; }
      if (node.type !== "tag") return;
      const offset = text.length;
      const tag = node.name;
      walk($(node).contents(), quoted || tag === "blockquote");
      const length = text.length - offset;
      if (!length) return;
      const types = { b: "bold", i: "italic", s: "strikethrough", u: "underline", code: "code", blockquote: "blockquote" } as const;
      if (tag === "a") entities.push({ type: "text_link", offset, length, url: $(node).attr("href") ?? "" });
      else if (tag === "pre") {
        const language = $(node).children("code").attr("class")?.replace(/^language-/, "");
        entities.push({ type: "pre", offset, length, ...(language ? { language } : {}) });
      } else if (tag in types && !(tag === "code" && node.parent?.type === "tag" && node.parent.name === "pre") && !(tag === "blockquote" && quoted)) {
        entities.push({ type: types[tag as keyof typeof types], offset, length });
      }
    });
  };
  walk($.root().contents());
  if (!text.trim()) return [{ text: "Done", entities: [] }];
  const chunks: { text: string; entities: MessageEntity[] }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    const chunkEntities = entities.flatMap((entity): MessageEntity[] => {
      const left = Math.max(start, entity.offset);
      const right = Math.min(end, entity.offset + entity.length);
      return left < right ? [{ ...entity, offset: left - start, length: right - left }] : [];
    });
    chunks.push({ text: text.slice(start, end), entities: chunkEntities });
    start = end;
  }
  return chunks;
}

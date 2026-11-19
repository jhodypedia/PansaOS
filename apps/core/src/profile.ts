import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import { config } from "./config.js";
import { redact } from "./security.js";

const defaultSoul = `# SOUL.md\n\nNama: Pansa\n\nKamu adalah asisten pribadi yang hangat, jujur, teliti, dan proaktif secukupnya. Gunakan Bahasa Indonesia sebagai bahasa default. Kenali konteks pengguna dan bantu percakapan, pertanyaan, riset, tulisan, catatan, jadwal, otomasi, serta pekerjaan teknis. Bedakan fakta terverifikasi dan dugaan; jangan mengarang hasil. Jaga privasi dan minta persetujuan eksplisit sebelum mengirim pesan atas nama pengguna, memposting, membeli, atau melakukan tindakan berdampak. Jangan meminta password atau API key dalam chat biasa.\n`;
const defaultUser = `# Profil Pengguna\n\n- Nama: (belum diketahui)\n- Panggilan: (belum diketahui)\n- Zona waktu: Asia/Jakarta\n- Bahasa: Bahasa Indonesia\n\n## Preferensi\n\n## Orang penting\n\n## Proyek dan tujuan berjalan\n`;
const defaultMemory = `# Memori Jangka Panjang\n\nFakta, preferensi, keputusan, komitmen, hubungan, dan hasil penting yang dipilih pengguna untuk diingat.\n`;

export class Profile {
  constructor(private store: Store) {}

  async initialize() {
    await fs.mkdir(config.home, { recursive: true });
    await fs.chmod(config.home, 0o700);
    for (const [file, value] of [[config.soul, defaultSoul], [config.user, defaultUser], [config.memory, defaultMemory]] as const) {
      await fs.writeFile(file, value, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    await this.index(config.user);
    await this.index(config.memory);
  }

  async read(which: "soul" | "user" | "memory") {
    return fs.readFile(which === "soul" ? config.soul : which === "user" ? config.user : config.memory, "utf8");
  }

  async write(which: "soul" | "user" | "memory", content: string) {
    if (content.length > 200_000) throw new Error("Dokumen terlalu besar");
    const file = which === "soul" ? config.soul : which === "user" ? config.user : config.memory;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.secureWrite(file, content);
    if (which !== "soul") await this.index(file);
  }

  private async secureWrite(file: string, content: string) {
    await fs.writeFile(file, content, { mode: 0o600 });
    await fs.chmod(file, 0o600);
  }

  private async index(file: string) {
    const key = path.basename(file);
    const body = await fs.readFile(file, "utf8");
    if (key === "MEMORY.md") this.store.run("DELETE FROM memory WHERE profile_doc='MEMORY.md'");
    else if (key === "USER.md") this.store.run("DELETE FROM memory WHERE profile_doc='USER.md'");
    else return;

    const add = (id: string, category: string, label: string, content: string, session?: string) => {
      this.store.run(
        "INSERT INTO memory(id,session_id,kind,key,content,source_session,category,source_type,profile_doc) VALUES(?,NULL,'profile',?,?,?,?, 'profile',?)",
        id, `${category}: ${label}`, `${category}: ${label}\n${content}`, session ?? null, category, key,
      );
    };
    if (key === "MEMORY.md") {
      for (const section of body.split(/(?=^## \[)/m).slice(1)) {
        const match = section.match(/^## \[([a-f0-9-]+)\] ([^:]+): (.+?)(?: \[session:([a-f0-9-]+)\])?\n([\s\S]*)$/);
        if (match) add(match[1]!, match[2]!, match[3]!, match[5]!.trim(), match[4]);
      }
      return;
    }
    for (const section of body.split(/(?=^### \[memory:)/m)) {
      const match = section.match(/^### \[memory:([a-f0-9-]+)\] ([^:]+): (.+?)(?: \[session:([a-f0-9-]+)\])?\n([\s\S]*)$/);
      if (match) add(`${match[1]}-user`, match[2]!, match[3]!, match[5]!.trim(), match[4]);
      else {
        const plain = section.trim();
        if (plain && !plain.startsWith("#")) add(randomUUID(), "fakta", "Profil pengguna", plain);
      }
    }
  }

  async relevant(query: string) {
    const terms = new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []);
    const output: string[] = [];
    for (const [label, file] of [["Profil pengguna", config.user], ["Memori terkurasi", config.memory]] as const) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      const chunks = file === config.memory
        ? content.split(/(?=^## \[)/m).filter((section) => section.startsWith("## [")).map((text) => text.trim())
        : content.split(/(?=^### \[memory:)/m).map((text) => text.trim()).filter(Boolean);
      const ranked = chunks.map((text) => ({ text, score: [...terms].reduce((n, term) => n + Number(text.toLocaleLowerCase().includes(term)), 0) }))
        .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
      if (ranked.length) output.push(`${label}:\n${ranked.map((item) => item.text).join("\n\n")}`);
    }
    return output.join("\n\n");
  }

  async saveMemory(category: string, key: string, content: string, session?: string) {
    const id = randomUUID();
    const safeContent = redact(content, this.store.secrets);
    const memory = await fs.readFile(config.memory, "utf8").catch(() => defaultMemory);
    await this.secureWrite(config.memory, `${memory.trimEnd()}\n\n## [${id}] ${category}: ${key}${session ? ` [session:${session}]` : ""}\n${safeContent}\n`);
    const user = await fs.readFile(config.user, "utf8").catch(() => defaultUser);
    await this.secureWrite(config.user, `${user.trimEnd()}\n\n## Catatan yang dipelajari\n\n### [memory:${id}] ${category}: ${key}${session ? ` [session:${session}]` : ""}\n${safeContent}\n`);
    await this.index(config.memory);
    await this.index(config.user);
    return { id, saved: true };
  }

  async forgetMemory(query: string, session?: string) {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const matches = this.store.all("SELECT * FROM memory WHERE (key LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') AND (session_id IS NULL OR session_id=?)", pattern, pattern, session ?? "");
    if (!matches.length) return { deleted: 0, verified: true };
    const ids = new Set(matches.map((row) => String(row.id).replace(/-user$/, "")));
    const memory = await fs.readFile(config.memory, "utf8").catch(() => "");
    const user = await fs.readFile(config.user, "utf8").catch(() => "");
    const nextMemory = memory.split(/(?=^## \[)/m).filter((section) => ![...ids].some((id) => section.startsWith(`## [${id}] `))).join("").replace(/\n{3,}/g, "\n\n");
    const nextUser = user.split(/(?=^### \[memory:)/m).filter((section) => ![...ids].some((id) => section.startsWith(`### [memory:${id}]`))).join("").replace(/\n{3,}/g, "\n\n");
    if (nextMemory !== memory) await this.secureWrite(config.memory, nextMemory);
    if (nextUser !== user) await this.secureWrite(config.user, nextUser);
    for (const row of matches) await this.store.deleteMemory(String(row.id));
    await this.index(config.memory);
    await this.index(config.user);
    const verified = matches.every((row) => !this.store.get("SELECT id FROM memory WHERE id=?", String(row.id))) && ![...ids].some((id) => nextMemory.includes(`## [${id}]`) || nextUser.includes(`### [memory:${id}]`));
    return { deleted: matches.length, verified };
  }

  async deleteMemory(id: string) {
    const row = this.store.get("SELECT * FROM memory WHERE id=?", id);
    if (!row) return { deleted: false, verified: true };
    if (row.source_type === "profile" && String(row.profile_doc) === "USER.md" && !id.endsWith("-user")) {
      const user = await fs.readFile(config.user, "utf8");
      const target = String(row.content).trim();
      if (!target || !user.includes(target)) throw new Error("Memori profil tidak ditemukan di USER.md");
      await this.secureWrite(config.user, user.replace(target, "").replace(/\n{3,}/g, "\n\n"));
      await this.index(config.user);
      return { deleted: true, verified: !this.store.all("SELECT id FROM memory WHERE profile_doc='USER.md'").some((item) => item.id === id) };
    }
    if (row.source_type === "profile" && ["MEMORY.md", "USER.md"].includes(String(row.profile_doc))) {
      const originalId = id.endsWith("-user") ? id.slice(0, -5) : id;
      const memory = await fs.readFile(config.memory, "utf8").catch(() => "");
      const user = await fs.readFile(config.user, "utf8").catch(() => "");
      const nextMemory = memory.split(/(?=^## \[)/m).filter((section) => !section.startsWith(`## [${originalId}] `)).join("").replace(/\n{3,}/g, "\n\n");
      const nextUser = user.split(/(?=^### \[memory:)/m).filter((section) => !section.startsWith(`### [memory:${originalId}]`)).join("").replace(/\n{3,}/g, "\n\n");
      await this.secureWrite(config.memory, nextMemory);
      await this.secureWrite(config.user, nextUser);
      this.store.run("DELETE FROM memory WHERE id IN (?,?)", originalId, `${originalId}-user`);
      await this.index(config.memory);
      await this.index(config.user);
      return { deleted: true, verified: !this.store.get("SELECT id FROM memory WHERE id IN (?,?)", originalId, `${originalId}-user`) };
    }
    await this.store.deleteMemory(id);
    return { deleted: true, verified: !this.store.get("SELECT id FROM memory WHERE id=?", id) };
  }

  async updateMemory(id: string, key: string, content: string) {
    const row = this.store.get("SELECT * FROM memory WHERE id=?", id);
    if (!row) throw new Error("Memori tidak ditemukan");
    if (row.source_type === "profile" && row.profile_doc === "USER.md" && !id.endsWith("-user")) {
      const user = await fs.readFile(config.user, "utf8");
      const target = String(row.content).trim();
      if (!target || !user.includes(target)) throw new Error("Memori profil tidak ditemukan di USER.md");
      await this.secureWrite(config.user, user.replace(target, redact(content, this.store.secrets)));
      await this.index(config.user);
      return { ok: true };
    }
    if (row.source_type === "profile" && ["MEMORY.md", "USER.md"].includes(String(row.profile_doc))) {
      const originalId = id.replace(/-user$/, "");
      const category = String(row.category);
      const session = row.source_session ? ` [session:${row.source_session}]` : "";
      const memory = await fs.readFile(config.memory, "utf8");
      const memorySections = memory.split(/(?=^## \[)/m);
      const memoryIndex = memorySections.findIndex((section) => section.startsWith(`## [${originalId}] `));
      if (memoryIndex >= 0) memorySections[memoryIndex] = `## [${originalId}] ${category}: ${key}${session}\n${redact(content, this.store.secrets)}\n`;
      await this.secureWrite(config.memory, memorySections.join(""));
      const user = await fs.readFile(config.user, "utf8");
      const userSections = user.split(/(?=^### \[memory:)/m);
      const userIndex = userSections.findIndex((section) => section.startsWith(`### [memory:${originalId}]`));
      if (userIndex >= 0) userSections[userIndex] = `### [memory:${originalId}] ${category}: ${key}${session}\n${redact(content, this.store.secrets)}\n`;
      else if (row.profile_doc === "USER.md") {
        const oldContent = String(row.content).split("\n").slice(1).join("\n").trim();
        const plainIndex = userSections.findIndex((section) => section.includes(oldContent));
        if (plainIndex >= 0) userSections[plainIndex] = userSections[plainIndex]!.replace(oldContent, `${category}: ${key}\n${redact(content, this.store.secrets)}`);
      }
      await this.secureWrite(config.user, userSections.join(""));
      await this.index(config.memory);
      await this.index(config.user);
      return { ok: true };
    }
    this.store.run("UPDATE memory SET key=?,content=? WHERE id=?", key, redact(content, this.store.secrets), id);
    return { ok: true };
  }
}

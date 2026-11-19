import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { redact } from "./security.js";

export type Row = Record<string, unknown>;
export type EventType =
  | "message"
  | "token"
  | "progress"
  | "tool"
  | "switch"
  | "error"
  | "usage"
  | "task"
  | "approval"
  | "audit"
  | "health";
export interface LiveEvent {
  id: number;
  type: EventType;
  session_id: string | null;
  data: Row;
  created_at: string;
}
export class Store {
  db: Database.Database;
  bus = new EventEmitter();
  secrets: string[] = [];
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);`,
    );
    this.db.transaction(() => {
      if (
        this.db.prepare("SELECT version FROM migrations WHERE version=1").get()
      )
        return;
      this.db.exec(`
      CREATE TABLE providers(id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, model TEXT NOT NULL, adapter TEXT NOT NULL DEFAULT 'openai', priority INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, capabilities TEXT DEFAULT '[]', cost_per_1k REAL DEFAULT 0, rate_limit INTEGER DEFAULT 60, failures INTEGER DEFAULT 0, cooldown_until INTEGER DEFAULT 0, cooldown_level INTEGER DEFAULT 0, latency REAL DEFAULT 0, successes INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0);
      CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, chat_id INTEGER UNIQUE, auto_approve INTEGER DEFAULT 0, pinned TEXT, strict INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT REFERENCES sessions(id), payload TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE events(id INTEGER PRIMARY KEY, type TEXT NOT NULL, session_id TEXT, data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX events_session ON events(session_id,id);
      CREATE TABLE memory(id TEXT PRIMARY KEY, session_id TEXT, kind TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE VIRTUAL TABLE memory_fts USING fts5(key,content,content='memory',content_rowid='rowid');
      CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN INSERT INTO memory_fts(rowid,key,content) VALUES(new.rowid,new.key,new.content); END;
      CREATE TRIGGER memory_ad AFTER DELETE ON memory BEGIN INSERT INTO memory_fts(memory_fts,rowid,key,content) VALUES('delete',old.rowid,old.key,old.content); END;
      CREATE TRIGGER memory_au AFTER UPDATE ON memory BEGIN INSERT INTO memory_fts(memory_fts,rowid,key,content) VALUES('delete',old.rowid,old.key,old.content); INSERT INTO memory_fts(rowid,key,content) VALUES(new.rowid,new.key,new.content); END;
      CREATE TABLE approvals(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,tool TEXT NOT NULL,args TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE auth(token TEXT PRIMARY KEY,expires INTEGER NOT NULL,one_time INTEGER DEFAULT 0);
      CREATE TABLE schedules(id TEXT PRIMARY KEY,cron TEXT NOT NULL,prompt TEXT NOT NULL,session_id TEXT NOT NULL,enabled INTEGER DEFAULT 1,last_run INTEGER DEFAULT 0);
       INSERT INTO migrations VALUES(1);`);
    })();
    this.migrate();
  }
  private migrate() {
    const hasMigration = (version: number) => Boolean(this.db.prepare("SELECT version FROM migrations WHERE version=?").get(version));
    if (!hasMigration(2)) this.db.transaction(() => {
      this.db.exec("ALTER TABLE memory ADD COLUMN source_session TEXT; ALTER TABLE memory ADD COLUMN category TEXT NOT NULL DEFAULT 'fakta'; ALTER TABLE memory ADD COLUMN source_type TEXT NOT NULL DEFAULT 'conversation'; INSERT INTO migrations(version) VALUES(2);");
    })();
    if (!hasMigration(3)) this.db.transaction(() => {
      this.db.exec("UPDATE memory SET source_session=session_id WHERE source_session IS NULL AND session_id IS NOT NULL; UPDATE memory SET session_id=NULL WHERE kind NOT IN ('episodic','note'); INSERT INTO migrations(version) VALUES(3);");
    })();
    if (!hasMigration(4)) this.db.transaction(() => {
      this.db.exec("ALTER TABLE memory ADD COLUMN profile_doc TEXT; INSERT INTO migrations(version) VALUES(4);");
    })();
    if (!hasMigration(5)) this.db.transaction(() => {
      this.db.exec("ALTER TABLE providers ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 4096; ALTER TABLE providers ADD COLUMN context_window INTEGER NOT NULL DEFAULT 32000; ALTER TABLE providers ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 120000; INSERT INTO migrations(version) VALUES(5);");
    })();
    if (!hasMigration(6)) this.db.transaction(() => {
      this.db.exec("ALTER TABLE providers ADD COLUMN custom_headers TEXT NOT NULL DEFAULT ''; INSERT INTO migrations(version) VALUES(6);");
    })();
  }
  all(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  get(sql: string, ...params: (string | number | null)[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  event(type: EventType, session: string | null, data: Row): LiveEvent {
    const clean = redact(data, this.secrets),
      result = this.run(
        "INSERT INTO events(type,session_id,data) VALUES(?,?,?)",
        type,
        session,
        clean,
      );
    const event: LiveEvent = {
      id: Number(result.lastInsertRowid),
      type,
      session_id: session,
      data: JSON.parse(clean) as Row,
      created_at: new Date().toISOString(),
    };
    this.bus.emit("event", event);
    return event;
  }
  session(
    title = "New session",
    chat: number | null = null,
  ): Row & { id: string } {
    if (chat !== null) {
      const existing = this.get("SELECT * FROM sessions WHERE chat_id=?", chat);
      if (existing) return { ...existing, id: String(existing.id) };
    }
    const id = randomUUID();
    this.run(
      "INSERT INTO sessions(id,title,chat_id) VALUES(?,?,?)",
      id,
      title,
      chat,
    );
    return { ...this.get("SELECT * FROM sessions WHERE id=?", id)!, id };
  }
  remember(
    key: string,
    content: string,
    kind = "fact",
    session: string | null = null,
  ): string {
    const id = randomUUID();
    const scoped = (kind === "episodic" || kind === "note") && session !== null;
    this.run(
      "INSERT INTO memory(id,key,content,kind,session_id,source_session,category,source_type) VALUES(?,?,?,?,?,?,?,?)",
      id,
      key,
      redact(content, this.secrets),
      kind,
      scoped ? session : null,
      session,
      ({ preference: "preferensi", preferensi: "preferensi", decision: "keputusan", keputusan: "keputusan", commitment: "komitmen", komitmen: "komitmen", relationship: "hubungan", hubungan: "hubungan" } as Record<string, string>)[kind] ?? "fakta",
      ["fact", "preference", "preferensi", "decision", "keputusan", "commitment", "komitmen", "relationship", "hubungan"].includes(kind) ? "conversation" : "conversation",
    );
    return id;
  }
  recall(query: string, session?: string): Row[] {
    const terms = query
      .match(/[\p{L}\p{N}_]+/gu)
      ?.slice(0, 12)
      .map((t) => `"${t}"`)
      .join(" OR ");
    return terms
      ? this.all(
           "SELECT m.* FROM memory m JOIN memory_fts f ON m.rowid=f.rowid WHERE memory_fts MATCH ? AND (m.session_id IS NULL OR m.session_id=?) ORDER BY rank LIMIT 20",
           terms,
           session ?? "",
        )
      : this.all("SELECT * FROM memory WHERE session_id IS NULL OR session_id=? ORDER BY rowid DESC LIMIT 100", session ?? "");
  }
  async deleteMemory(id: string): Promise<boolean> {
    this.run("DELETE FROM memory WHERE id=?", id);
    const exists = this.get("SELECT id FROM memory WHERE id=?", id);
    if (exists) throw new Error("Memory could not be deleted");
    return true;
  }
  purgeSession(session: string): number {
    return this.db.transaction(() => {
      this.run("DELETE FROM memory WHERE session_id=?", session);
      this.run("DELETE FROM approvals WHERE session_id=?", session);
      this.run("DELETE FROM schedules WHERE session_id=?", session);
      this.run("DELETE FROM messages WHERE session_id=?", session);
      this.run("DELETE FROM events WHERE session_id=?", session);
      return Number(
        this.run("DELETE FROM sessions WHERE id=?", session).changes,
      );
    })();
  }
  setting(key: string, fallback = ""): string {
    return String(
      this.get("SELECT value FROM settings WHERE key=?", key)?.value ??
        fallback,
    );
  }
  set(key: string, value: string) {
    this.run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      value,
    );
  }
}

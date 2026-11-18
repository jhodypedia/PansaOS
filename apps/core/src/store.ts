import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { redact } from "./security.js";

export type Row = Record<string, unknown>;
export type EventType =
  | "message"
  | "token"
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
      CREATE TABLE bounties(id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT DEFAULT '', brief TEXT DEFAULT '', deadline TEXT DEFAULT '', criteria TEXT DEFAULT '[]', status TEXT DEFAULT 'baru', session_id TEXT, result TEXT DEFAULT '', score REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE approvals(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,tool TEXT NOT NULL,args TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE auth(token TEXT PRIMARY KEY,expires INTEGER NOT NULL,one_time INTEGER DEFAULT 0);
      CREATE TABLE schedules(id TEXT PRIMARY KEY,cron TEXT NOT NULL,prompt TEXT NOT NULL,session_id TEXT NOT NULL,enabled INTEGER DEFAULT 1,last_run INTEGER DEFAULT 0);
      INSERT INTO migrations VALUES(1);`);
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
    title = "Session baru",
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
    this.run(
      "INSERT INTO memory(id,key,content,kind,session_id) VALUES(?,?,?,?,?)",
      id,
      key,
      redact(content, this.secrets),
      kind,
      session,
    );
    return id;
  }
  recall(query: string): Row[] {
    const terms = query
      .match(/[\p{L}\p{N}_]+/gu)
      ?.slice(0, 12)
      .map((t) => `"${t}"`)
      .join(" OR ");
    return terms
      ? this.all(
          "SELECT m.* FROM memory m JOIN memory_fts f ON m.rowid=f.rowid WHERE memory_fts MATCH ? ORDER BY rank LIMIT 20",
          terms,
        )
      : this.all("SELECT * FROM memory ORDER BY rowid DESC LIMIT 100");
  }
  purgeSession(session: string): number {
    return this.db.transaction(() => {
      this.run("DELETE FROM memory WHERE session_id=?", session);
      this.run("DELETE FROM approvals WHERE session_id=?", session);
      this.run("DELETE FROM schedules WHERE session_id=?", session);
      this.run(
        "UPDATE bounties SET session_id=NULL WHERE session_id=?",
        session,
      );
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

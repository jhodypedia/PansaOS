import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function encrypt(value: string, master: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(master, "hex"), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(value: string, master: string): string {
  const [iv, tag, body] = value.split(".").map((s) => Buffer.from(s, "base64"));
  if (!iv || !tag || !body) throw new Error("Ciphertext invalid");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(master, "hex"),
    iv,
  );
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString();
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export const mask = (s: string) => (s ? `sk-…${s.slice(-3)}` : "tanpa key");
export function redact(value: unknown, secrets: string[] = []): string {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const s of secrets)
    if (s.length > 3) text = text.split(s).join("[REDACTED]");
  return text
    .replace(/\b(?:sk-|gsk_|AIza)[a-zA-Z0-9_\-]{12,}/g, "[REDACTED]")
    .replace(/\b\d{8,}:[A-Za-z0-9_-]{25,}/g, "[REDACTED]");
}
export async function safePath(root: string, input: string): Promise<string> {
  const base = await fs.realpath(root),
    resolved = path.resolve(base, input);
  if (resolved !== base && !resolved.startsWith(base + path.sep))
    throw new Error(
      `Path di luar workspace ditolak (workspace session ini: ${path.basename(base)}; pakai path relatif, contoh: connect-body.json)`,
    );
  let cursor = resolved;
  while (true) {
    try {
      const real = await fs.realpath(cursor);
      if (real !== base && !real.startsWith(base + path.sep))
        throw new Error("Symlink keluar workspace ditolak");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      cursor = path.dirname(cursor);
    }
  }
  return resolved;
}
function privateIP(ip: string): boolean {
  if (ip.includes(":")) {
    const s = ip.toLowerCase();
    if (s.startsWith("::ffff:")) return privateIP(s.slice(7));
    return (
      s === "::1" ||
      s === "::" ||
      /^(fc|fd|fe[89ab]|ff)/.test(s) ||
      s.startsWith("2001:db8:")
    );
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
export async function checkURL(
  input: string,
  allowPrivate = false,
): Promise<URL> {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("URL HTTP(S) tanpa userinfo diperlukan");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (!ips.length || (!allowPrivate && ips.some((i) => privateIP(i.address))))
    throw new Error("Jaringan privat/metadata diblokir");
  return url;
}
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  allowPrivate = false,
): Promise<Response> {
  let url = input;
  for (let i = 0; i < 5; i++) {
    await checkURL(url, allowPrivate);
    const response = await fetch(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, url).toString();
    if (new URL(next).origin !== new URL(url).origin)
      init = { ...init, headers: {}, body: undefined, method: "GET" };
    await response.body?.cancel();
    url = next;
  }
  throw new Error("Redirect terlalu banyak");
}
export async function limitedBody(
  response: Response,
  max = 5_000_000,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Respons melebihi batas ukuran");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signMessage,
  type KeyObject,
} from "node:crypto";
import { config } from "./config.js";
import { decrypt, encrypt, redact } from "./security.js";
import { Store } from "./store.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const KEYPAIR_SETTING = "makefun_keypair";
const CREDENTIAL_SETTING = "makefun_credentials";
const PENDING_SETTING = "makefun_pending_connect";

function base58(buffer: Buffer): string {
  let value = BigInt("0x" + (buffer.toString("hex") || "0"));
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

export interface Keypair {
  address: string;
  secret: string;
}

export function createKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x as string;
  return {
    address: base58(Buffer.from(x, "base64url")),
    secret: privateKey.export({ format: "der", type: "pkcs8" }).toString(
      "base64",
    ),
  };
}

export function addressOf(keypair: Keypair): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(keypair.secret, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const x = createPublicKey(privateKey).export({ format: "jwk" })
    .x as string;
  return base58(Buffer.from(x, "base64url"));
}

export function signWith(keypair: Keypair, message: string): string {
  const privateKey: KeyObject = createPrivateKey({
    key: Buffer.from(keypair.secret, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return base58(signMessage(null, Buffer.from(message, "utf8"), privateKey));
}

export class Makefun {
  connect: {
    deviceCode: string;
    message: string;
    expiresAt: number;
    code: string;
    connectUrl: string;
    wallet: string;
    keypairCreated: boolean;
  } | null = null;
  constructor(public store: Store) {
    const pending = store.setting(PENDING_SETTING);
    if (pending) {
      try {
        const parsed = JSON.parse(decrypt(pending, config.MASTER_KEY)) as {
          deviceCode: string;
          message: string;
          expiresAt: number;
          code: string;
          connectUrl: string;
          wallet: string;
          keypairCreated: boolean;
        };
        if (parsed.expiresAt > Date.now()) this.connect = parsed;
        else store.run("DELETE FROM settings WHERE key=?", PENDING_SETTING);
      } catch {}
    }
  }
  private persistPending() {
    if (this.connect)
      this.store.set(
        PENDING_SETTING,
        encrypt(JSON.stringify(this.connect), config.MASTER_KEY),
      );
    else this.store.run("DELETE FROM settings WHERE key=?", PENDING_SETTING);
  }

  base(): string {
    return (
      this.store.setting("makefun_base_url", "https://make.fun") ||
      "https://make.fun"
    ).replace(/\/+$/, "");
  }

  apiKey(): string {
    const stored = this.store.setting(CREDENTIAL_SETTING);
    if (!stored) return "";
    try {
      return decrypt(stored, config.MASTER_KEY);
    } catch {
      return "";
    }
  }

  saveApiKey(value: string) {
    this.store.set(CREDENTIAL_SETTING, encrypt(value, config.MASTER_KEY));
  }

  keypair(): Keypair | null {
    const stored = this.store.setting(KEYPAIR_SETTING);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(decrypt(stored, config.MASTER_KEY)) as Keypair;
      return parsed.address && parsed.secret ? parsed : null;
    } catch {
      return null;
    }
  }

  keypairOrCreate(): { keypair: Keypair; created: boolean } {
    const existing = this.keypair();
    if (existing) return { keypair: existing, created: false };
    const keypair = createKeypair();
    this.store.set(
      KEYPAIR_SETTING,
      encrypt(JSON.stringify(keypair), config.MASTER_KEY),
    );
    return { keypair, created: true };
  }

  async me(): Promise<{
    ok: boolean;
    status: number;
    body: Record<string, unknown>;
  }> {
    const key = this.apiKey();
    if (!key)
      return { ok: false, status: 0, body: { reason: "kredensial kosong" } };
    const response = await fetch(`${this.base()}/api/agents/me`, {
      headers: { "x-api-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    const text = redact(raw.slice(0, config.TOOL_OUTPUT_LIMIT), this.store.secrets);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      body = parsed && typeof parsed === "object" ? parsed : { value: parsed };
    } catch {
      body = { body: text };
    }
    return { ok: response.ok, status: response.status, body };
  }

  async startConnect(): Promise<{
    code: string;
    connect_url: string;
    expires_in: number;
    expires_at: string;
    wallet_address: string;
    keypair_created: boolean;
    keypair_location: string;
    reused_pending_request: boolean;
    instruction: string;
  }> {
    const pending = this.connect;
    if (pending && Date.now() < pending.expiresAt - 5000)
      return {
        code: pending.code,
        connect_url: pending.connectUrl,
        expires_in: Math.max(
          0,
          Math.ceil((pending.expiresAt - Date.now()) / 1000),
        ),
        expires_at: new Date(pending.expiresAt).toISOString(),
        wallet_address: pending.wallet,
        keypair_created: pending.keypairCreated,
        keypair_location:
          "terenkripsi di database core (settings.makefun_keypair), bukan di workspace",
        reused_pending_request: true,
        instruction:
          "Permintaan connect yang masih berlaku dipakai ulang (tidak ada kode baru, tidak ada keypair baru). Kirim ulang kode dan link ini verbatim ke owner, lalu berhenti menunggu.",
      };
    const { keypair, created } = this.keypairOrCreate();
    const derived = addressOf(keypair);
    if (derived !== keypair.address)
      throw new Error(
        "Alamat turunan tidak cocok dengan keypair tersimpan; keypair rusak, minta owner membuat ulang",
      );
    const response = await fetch(`${this.base()}/api/agents/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: derived,
        name: "PansaOS",
        device: {
          harness: "pansaos",
          os: process.platform,
          host: "pansaos-core",
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    const text = redact(raw.slice(0, config.TOOL_OUTPUT_LIMIT), this.store.secrets);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Respons connect bukan JSON (HTTP ${response.status})`);
    }
    if (!response.ok)
      throw new Error(
        `Connect gagal (HTTP ${response.status}): ${String(
          (body.error as { message?: string }[] | undefined)?.[0]?.message ??
            text.slice(0, 200),
        )}`,
      );
    const message = String(body.message ?? "");
    if (!message.includes(derived))
      throw new Error(
        "Pesan connect tidak memuat alamat wallet turunan; kode tidak dikirim",
      );
    const expiresIn = Number(body.expires_in ?? 900);
    const code = String(body.user_code);
    const connectUrl =
      String(body.verification_uri_complete ?? "") ||
      String(body.verification_uri ?? `${this.base()}/connect`);
    this.connect = {
      deviceCode: String(body.device_code),
      message,
      expiresAt: Date.now() + expiresIn * 1000,
      code,
      connectUrl,
      wallet: derived,
      keypairCreated: created,
    };
    this.persistPending();
    return {
      code,
      connect_url: connectUrl,
      expires_in: expiresIn,
      expires_at: new Date(this.connect.expiresAt).toISOString(),
      wallet_address: derived,
      keypair_created: created,
      keypair_location:
        "terenkripsi di database core (settings.makefun_keypair), bukan di workspace",
      reused_pending_request: false,
      instruction:
        "Kirim kode dan link ini ke owner sekarang, lalu berhenti menunggu. Jangan mengerjakan langkah lain yang memakan langkah sebelum owner menyetujui.",
    };
  }

  async pollConnect(): Promise<{
    connected: boolean;
    status: string;
    expires_in: number;
    handle?: string;
    detail?: string;
  }> {
    if (!this.connect)
      return {
        connected: false,
        status: "belum_ada_permintaan",
        expires_in: 0,
        detail: "Panggil makefun_connect dulu",
      };
    if (Date.now() > this.connect.expiresAt)
      return {
        connected: false,
        status: "expired",
        expires_in: 0,
        detail: "Kode kedaluwarsa; panggil makefun_connect untuk kode baru",
      };
    const keypair = this.keypair();
    if (!keypair) throw new Error("Keypair tidak ditemukan");
    const response = await fetch(`${this.base()}/api/agents/connect/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_code: this.connect.deviceCode,
        signature: signWith(keypair, this.connect.message),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    const text = redact(raw.slice(0, config.TOOL_OUTPUT_LIMIT), this.store.secrets);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {}
    const expiresIn = Math.max(
      0,
      Math.ceil((this.connect.expiresAt - Date.now()) / 1000),
    );
    if (response.ok) {
      const apiKey = String(
        body.api_key ?? body.apiKey ?? (body.key as string) ?? "",
      );
      if (apiKey) this.saveApiKey(apiKey);
      this.connect = null;
      this.persistPending();
      const user = body.user as { handle?: string } | undefined;
      return {
        connected: true,
        status: "connected",
        expires_in: expiresIn,
        handle: user?.handle,
        detail: apiKey
          ? "Kunci API tersimpan terenkripsi"
          : "Respons sukses tanpa kunci; periksa makefun_status",
      };
    }
    const error = String(
      body.error ?? (body.error_description as string) ?? `HTTP ${response.status}`,
    );
    return {
      connected: false,
      status: error,
      expires_in: expiresIn,
      detail: String(body.error_description ?? "").slice(0, 200),
    };
  }
}

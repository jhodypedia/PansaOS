import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store.js";
import { Providers, providerSchema } from "./providers.js";
import { decrypt } from "./security.js";

const key = "a".repeat(64);
const draft = { name: "Test", base_url: "https://models.example/v1/", api_key: "example-secret-provider-key", model: "test-model", adapter: "anthropic" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("provider connection settings", () => {
  it("rejects header injection, transport overrides, and case-insensitive duplicates", () => {
    for (const custom_headers of [{ "Bad\r\nName": "value" }, { "X-Key": "secret\r\nInjected: true" }, { Host: "other.example" }, { "Content-Length": "5" }, { Authorization: "one", authorization: "two" }])
      expect(() => providerSchema.parse({ ...draft, custom_headers })).toThrow();
    expect(providerSchema.parse({ ...draft, custom_headers: { "User-Agent": "Pansa" } }).custom_headers).toEqual({ "user-agent": "Pansa" });
  });
  it("encrypts header values, returns only names, and redacts values from events", () => {
    const store = new Store(":memory:");
    try {
      const providers = new Providers(store, key);
      const id = providers.save({ ...draft, custom_headers: { "X-Gateway-Key": "private-header-secret" } });
      const row = store.get("SELECT * FROM providers WHERE id=?", id)!;
      expect(String(row.custom_headers)).not.toContain("private-header-secret");
      expect(JSON.parse(decrypt(String(row.custom_headers), key))).toEqual({ "x-gateway-key": "private-header-secret" });
      expect(providers.list()[0]!.configured_headers).toEqual(["x-gateway-key"]);
      expect(providers.list()[0]).not.toHaveProperty("custom_headers");
      expect(JSON.stringify(providers.list())).not.toContain(String(row.custom_headers));
      expect(store.event("error", null, { error: "private-header-secret" }).data.error).toBe("[REDACTED]");
    } finally { store.db.close(); }
  });
  it("preserves saved headers on ordinary edits and removes them only through explicit replacement", () => {
    const store = new Store(":memory:");
    try {
      const providers = new Providers(store, key);
      const id = providers.save({ ...draft, custom_headers: { "X-Key": "keep-this-secret" } });
      providers.update(id, { name: "Renamed" });
      expect(providers.list()[0]!.configured_headers).toEqual(["x-key"]);
      providers.update(id, { custom_headers: {} });
      expect(providers.list()[0]!.configured_headers).toEqual([]);
    } finally { store.db.close(); }
  });
  it("uses saved or draft headers for model discovery and validation without persisting draft changes", async () => {
    const store = new Store(":memory:");
    try {
      const fetch = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith("/models") ? new Response(JSON.stringify({ data: [{ id: "model" }] })) : new Response(JSON.stringify({ content: [{ type: "text", text: "draft-header-secret" }] }), { headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", fetch);
      const providers = new Providers(store, key);
      const id = providers.save({ ...draft, custom_headers: { Authorization: "custom-saved-auth" } });
      await providers.models({}, id);
      expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ authorization: "custom-saved-auth" });
      const tested = await providers.testDraft({ custom_headers: { "X-Key": "draft-header-secret" } }, id);
      expect(fetch.mock.calls[1]![1]!.headers).toMatchObject({ "x-key": "draft-header-secret" });
      expect(tested.preview).not.toContain("draft-header-secret");
      expect(providers.list()[0]!.configured_headers).toEqual(["authorization"]);
    } finally { store.db.close(); }
  });
  it("validates endpoints and numeric settings before saving", () => {
    for (const base_url of ["file:///etc/passwd", "https://user:pass@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/v1#fragment"])
      expect(() => providerSchema.parse({ ...draft, base_url })).toThrow();
    for (const setting of [{ timeout_ms: 100 }, { max_output_tokens: -1 }, { context_window: 0 }, { rate_limit: 0 }])
      expect(() => providerSchema.parse({ ...draft, ...setting })).toThrow();
    expect(providerSchema.parse(draft).base_url).toBe("https://models.example/v1");
  });
  it("stores runtime settings and encrypts credentials, while listings remain masked", () => {
    const store = new Store(":memory:");
    try {
      const providers = new Providers(store, key);
      const id = providers.save({ ...draft, timeout_ms: 45000, context_window: 128000, max_output_tokens: 8000 });
      const row = store.get("SELECT * FROM providers WHERE id=?", id)!;
      expect(row).toMatchObject({ timeout_ms: 45000, context_window: 128000, max_output_tokens: 8000 });
      expect(row.api_key).not.toBe(draft.api_key);
      expect(decrypt(String(row.api_key), key)).toBe(draft.api_key);
      expect(JSON.stringify(providers.list())).not.toContain(draft.api_key);
    } finally { store.db.close(); }
  });
  it("preserves the saved key and configuration on partial edits and blank-key updates", () => {
    const store = new Store(":memory:");
    try {
      const providers = new Providers(store, key);
      const id = providers.save({ ...draft, priority: 3, context_window: 64000 });
      providers.update(id, { name: "Renamed", api_key: "", max_output_tokens: 8192 });
      providers.update(id, { enabled: false });
      const row = store.get("SELECT * FROM providers WHERE id=?", id)!;
      expect(row).toMatchObject({ name: "Renamed", priority: 3, context_window: 64000, max_output_tokens: 8192, enabled: 0 });
      expect(decrypt(String(row.api_key), key)).toBe(draft.api_key);
      expect(() => providers.update("missing", { name: "New" })).toThrow("Provider not found");
    } finally { store.db.close(); }
  });
  it("tests an unsaved connection and applies the chosen output limit and protocol", async () => {
    const store = new Store(":memory:");
    try {
      const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }], usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", fetch);
      const providers = new Providers(store, key);
      await expect(providers.testDraft({ ...draft, max_output_tokens: 8192 })).resolves.toMatchObject({ ok: true, model: "test-model", preview: "OK" });
      const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe("https://models.example/v1/messages");
      expect(JSON.parse(String(init.body))).toMatchObject({ model: "test-model", max_tokens: 8192, stream: false });
      expect(init.headers).toMatchObject({ "x-api-key": draft.api_key });
      expect(providers.list()).toHaveLength(0);
    } finally { store.db.close(); }
  });
  it("discovers models using saved credentials without changing the saved provider", async () => {
    const store = new Store(":memory:");
    try {
      const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "z-model" }, { id: "a-model", display_name: "A model" }] })));
      vi.stubGlobal("fetch", fetch);
      const providers = new Providers(store, key);
      const id = providers.save(draft);
      await expect(providers.models({ api_key: "" }, id)).resolves.toEqual({ models: [{ id: "a-model", name: "A model" }, { id: "z-model", name: "z-model" }] });
      const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe("https://models.example/v1/models");
      expect(init.headers).toMatchObject({ "x-api-key": draft.api_key });
      expect(init.redirect).toBe("error");
      expect(providers.list()[0]!.model).toBe("test-model");
    } finally { store.db.close(); }
  });
  it("does not save a draft when a connection test fails", async () => {
    const store = new Store(":memory:");
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
      const providers = new Providers(store, key);
      await expect(providers.testDraft(draft)).rejects.toThrow("HTTP 401");
      expect(providers.list()).toHaveLength(0);
      const id = providers.save(draft);
      await expect(providers.test(id)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("HTTP 401") });
      expect(providers.list()).toHaveLength(1);
    } finally { store.db.close(); }
  });
});

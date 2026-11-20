import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "./store.js";
import type { Agent } from "./agent.js";
import type { Providers } from "./providers.js";
import type { Tools } from "./tools.js";

describe("workspace file downloads", () => {
  it("streams a session file as an attachment and rejects paths outside the workspace", async () => {
    process.env.MASTER_KEY = "a".repeat(64);
    process.env.DASH_TOKEN = "file-download-test-token-123456789";
    const { routes } = await import("./routes.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "pansa-file-download-"));
    const store = new Store(":memory:");
    const session = String(store.session("file download").id);
    const file = path.join(root, "report final.pdf");
    const bytes = Buffer.from("%PDF-1.7\nPansa test document\n");
    await writeFile(file, bytes);
    const sandbox = { root: async () => root };
    const app = Fastify();
    try {
      await routes(app, store, { sandbox } as unknown as Tools, {} as Providers, {} as Agent);
      await app.ready();
      const download = await app.inject({ url: `/api/sessions/${session}/files/download?path=${encodeURIComponent("report final.pdf")}` });
      expect(download.statusCode).toBe(200);
      expect(download.headers["content-type"]).toBe("application/pdf");
      expect(download.headers["content-disposition"]).toContain("attachment;");
      expect(download.rawPayload).toEqual(bytes);
      const blocked = await app.inject({ url: `/api/sessions/${session}/files/download?path=${encodeURIComponent("../outside.pdf")}` });
      expect(blocked.statusCode).toBe(400);
      const missingSession = await app.inject({ url: `/api/sessions/${"f".repeat(36)}/files/download?path=report.pdf` });
      expect(missingSession.statusCode).toBe(404);
    } finally {
      await app.close();
      store.db.close();
      expect(await readFile(file)).toEqual(bytes);
      await rm(root, { recursive: true, force: true });
    }
  });
});

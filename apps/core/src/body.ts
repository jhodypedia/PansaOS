import type { FastifyInstance } from "fastify";

export function tolerantJsonBody(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = String(body ?? "").trim();
      if (!text) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch {
        done(
          Object.assign(new Error("Body JSON tidak valid"), { statusCode: 400 }),
          undefined,
        );
      }
    },
  );
}

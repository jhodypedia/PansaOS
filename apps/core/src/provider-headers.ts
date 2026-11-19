import { z } from "zod";

const reserved = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "te", "trailer", "expect", "content-type"]);
export const customHeadersSchema = z.record(
  z.string().min(1).max(128).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Invalid HTTP header name"),
  z.string().max(8192).regex(/^[\t\x20-\x7e]*$/, "Header values must contain printable ASCII without line breaks"),
).superRefine((headers, ctx) => {
  if (Object.keys(headers).length > 32) ctx.addIssue({ code: "custom", message: "Use at most 32 custom headers" });
  const names = new Set<string>();
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (reserved.has(lower)) ctx.addIssue({ code: "custom", path: [name], message: "This transport header is managed by PansaOS" });
    if (names.has(lower)) ctx.addIssue({ code: "custom", path: [name], message: "Duplicate header names are not allowed (case-insensitive)" });
    names.add(lower);
  }
}).transform(headers => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])));

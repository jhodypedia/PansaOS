import { z } from "zod";
import path from "node:path";

const env = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().default(3001),
    PUBLIC_URL: z.string().url().default("http://localhost:3000"),
    MASTER_KEY: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, "MASTER_KEY harus hex 32 byte"),
    DASH_TOKEN: z.string().min(24),
    BOT_TOKEN: z.string().default(""),
    ADMIN_IDS: z.string().default(""),
    DATA_DIR: z.string().default("../../data"),
    WORKSPACE_DIR: z.string().default("../../workspace"),
    HOST_WORKSPACE_DIR: z.string().optional(),
    SKILLS_DIR: z.string().default("../../skills"),
    PLUGINS_DIR: z.string().default("../../plugins"),
    SOUL_PATH: z.string().default("../../SOUL.md"),
    ALLOW_UNSANDBOXED: z.enum(["true", "false"]).default("false"),
    SANDBOX_NETWORK: z.enum(["true", "false"]).default("true"),
    SANDBOX_IMAGE: z.string().default("pansaos-sandbox:local"),
    MAX_STEPS: z.coerce.number().int().min(1).default(60),
    TASK_TIMEOUT_MS: z.coerce.number().default(900000),
    TOOL_OUTPUT_LIMIT: z.coerce.number().default(16000),
    MAX_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    MAX_TASK_COST: z.coerce.number().positive().default(5),
    WEBHOOK_SECRET: z.string().default(""),
    TELEGRAM_MODE: z.enum(["polling", "webhook", "auto"]).default("auto"),
    ALLOW_PRIVATE_NETWORK: z.enum(["true", "false"]).default("false"),
    SEARCH_URL: z.string().default(""),
    SEARCH_KEY: z.string().default(""),
    SCHEDULER_MODE: z.enum(["internal", "external"]).default("internal"),
  })
  .parse(process.env);
export const config = {
  ...env,
  data: path.resolve(env.DATA_DIR),
  workspace: path.resolve(env.WORKSPACE_DIR),
  skills: path.resolve(env.SKILLS_DIR),
  plugins: path.resolve(env.PLUGINS_DIR),
  admins: env.ADMIN_IDS.split(",")
    .map(Number)
    .filter(Number.isSafeInteger)
    .filter((n) => n > 0),
};

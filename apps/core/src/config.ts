import { z } from "zod";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const env = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().default(3001),
    PUBLIC_URL: z.string().url().default("http://localhost:3000"),
    MASTER_KEY: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, "MASTER_KEY must be a 32-byte hexadecimal value"),
    DASH_TOKEN: z.string().min(24),
    PANSA_HOME: z.string().default(path.join(os.homedir(), ".pansa")),
    BOT_TOKEN: z.string().default(""),
    ADMIN_IDS: z.string().default(""),
    DATA_DIR: z.string().optional(),
    WORKSPACE_DIR: z.string().default("../../workspace"),
    WORKSPACE_ALLOWLIST: z.string().default(""),
    HOST_WORKSPACE_DIR: z.string().optional(),
    EXEC_MODE: z.enum(["host", "docker"]).default("host"),
    EXEC_STATE_DIR: z.string().optional(),
    SKILLS_DIR: z.string().optional(),
    PLUGINS_DIR: z.string().optional(),
    SOUL_PATH: z.string().optional(),
    USER_PATH: z.string().optional(),
    MEMORY_PATH: z.string().optional(),
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
  home: path.resolve(env.PANSA_HOME),
  state: path.resolve(env.EXEC_STATE_DIR ?? path.join(env.PANSA_HOME, "state")),
  data: path.resolve(env.DATA_DIR ?? path.join(env.PANSA_HOME, "data")),
  workspace: path.resolve(env.WORKSPACE_DIR),
  workspaceAllowlist: [...new Set([env.WORKSPACE_DIR, ...env.WORKSPACE_ALLOWLIST.split(",").map((entry) => entry.trim()).filter(Boolean)].map((entry) => path.resolve(entry)))],
  skills: path.resolve(env.SKILLS_DIR ?? path.join(env.PANSA_HOME, "skills")),
  plugins: path.resolve(env.PLUGINS_DIR ?? path.join(env.PANSA_HOME, "plugins")),
  soul: path.resolve(env.SOUL_PATH ?? path.join(env.PANSA_HOME, "SOUL.md")),
  user: path.resolve(env.USER_PATH ?? path.join(env.PANSA_HOME, "USER.md")),
  memory: path.resolve(env.MEMORY_PATH ?? path.join(env.PANSA_HOME, "MEMORY.md")),
  admins: env.ADMIN_IDS.split(",")
    .map(Number)
    .filter(Number.isSafeInteger)
    .filter((n) => n > 0),
};

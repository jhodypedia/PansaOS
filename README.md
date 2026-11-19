# PansaOS

PansaOS is a self-hosted personal assistant for everyday conversation, research, writing, notes, memory, reminders, automation, and software development. English is the default interface and assistant language; the assistant follows your requested or saved language preference.

The `pansa` CLI, Telegram bot, and web dashboard share one core. Select the same session to continue its conversation across channels. Durable profile information and memories are shared globally. Internal data, profiles, shell state, and checkpoints live in `PANSA_HOME` (default `~/.pansa`).

## Install on a Linux VPS

Requirements: Linux, Node.js >=20.19, npm, `rsync`, and build tools if a `better-sqlite3` binary is unavailable. Service installation requires systemd. Local host execution does not require Docker. The installation flow has been tested on Ubuntu 24.04; other Linux distributions need compatible dependencies and systemd support.

```bash
git clone https://github.com/jhodypedia/PansaOS.git
cd PansaOS
./install.sh
```

The installer builds in staging before activating the new installation. If service startup fails, it restores the previous installation. Files are installed to `/opt/pansaos`, or `~/.local/share/pansaos` without system write access. Existing `~/.pansa/.env` settings are preserved with file mode `600`.

Run `sudo ./install.sh --service` to install the service as a non-root account. It uses local shell execution with `ProtectHome=tmpfs` and `ProtectSystem=strict`. The service binds `PANSA_HOME`, allowed project directories, and read-only application/runtime paths. Running `pansa serve` manually does not provide these systemd filesystem restrictions.

Set `WORKSPACE_ALLOWLIST` in `~/.pansa/.env` to a comma-separated list of allowed project roots, for example `WORKSPACE_ALLOWLIST=/home/alice/projects,/srv/web`. The default is `~/.pansa/workspace`. CLI workspace selection rejects directories outside this list. Rerun the installer with `--service` after changing the list to update systemd bind paths. Configure `PUBLIC_URL`, `BOT_TOKEN`, and `ADMIN_IDS` in the same environment file.

Service restrictions hide other home directories and make the system filesystem read-only. System files needed by the runtime remain readable. Core and shell use the same account, so shell execution can still access Pansa state and configuration in `PANSA_HOME`. This is not secret isolation or a workspace-only read boundary.

## Get started

### CLI

```bash
cd ~/my-project
pansa                 # interactive chat in this project
pansa --continue      # continue your last session
pansa run "Explain this project's structure"
pansa run "Add input validation and run tests" --yes
pansa run "Plan a migration" --plan
pansa doctor
pansa provider add
```

In **Build** mode, built-in file tools can edit the active workspace directly. Shell, Python, Node.js, and project commands request execution permission: choose **Allow once**, **Allow for session**, or **Deny** through CLI, Telegram, or the dashboard. Session grants apply to the approved session and workspace root, do not carry to other sessions, and expire when core restarts. `/permissions` shows active grants. `/permissions reset` or **Revoke session permissions** in Console revokes session grants and auto-approve. Automatic formatting only runs when execution permission is already present.

**Ask** mode ignores session grants and requests approval for each action. **Plan** mode remains read only. Protected actions such as commits, pushes, deletion, checkpoint restore, MCP tools, browser interactions, outbound messages, and mutating HTTP requests need one-time approval. Known high-impact shell patterns also request approval; detection is not a complete analysis of arbitrary code. Execution permission allows code to run with the Pansa account's filesystem/network access. `--yes` and `/autoapprove on` bypass routine approvals, but not protected actions.

REPL commands include `/new`, `/continue SESSION_ID`, `/model`, `/providers`, `/permissions`, `/memory`, `/doctor`, `/stop`, and `/exit`. The provider setup wizard uses hidden API-key input and encrypted credential storage.

### Connect an AI provider

Open **Providers → Add provider** or run `pansa provider add`. Available presets include OpenAI Chat Completions, OpenAI Responses, Anthropic, OpenRouter, DeepSeek, Google Gemini, Groq, Mistral, Together AI, Ollama, LM Studio, Xingchi API, and custom endpoints. Choose Chat Completions, Responses, or native Anthropic Messages as the API protocol.

Use **Discover models** to load model IDs from your endpoint, or enter an ID manually. **Test connection** checks the draft without saving it and may incur provider usage. Preset model IDs are suggestions; availability and tool-calling support depend on the provider and account. Configure fallback priority, requests per minute, output tokens, context window, timeout, and estimated cost in Advanced configuration. Editing a provider with a blank API key preserves its existing encrypted key.

The **Responses** adapter sends requests to `<base_url>/responses` with streaming, function tool definitions, function-call outputs, and stateless conversation history (`store: false`). It preserves returned reasoning items and assistant message phases for the same provider/model, and detects failed, incomplete, or interrupted streams before returning tool calls.

Use **Custom request headers** for provider-documented headers such as `User-Agent`, `OpenAI-Beta`, or gateway authentication. Values are encrypted at rest and redacted from recorded events; API listings return only header names. Leave **Replace all saved headers** unchecked when editing to retain existing values. Enable it to replace the entire set, including clearing it with an empty list. Header names are case-insensitive. Custom values override generated headers of the same name; transport headers and the JSON content type are managed by PansaOS. Requests do not follow redirects with credentials.

For Xingchi, the preset uses `https://api.xingchiapi.com/v1` and Responses. Enter a model enabled for your account and any headers specified by your provider. The public portal did not expose verified header requirements during implementation; no Claude/Codex identity headers are enabled automatically. Protocol/header support alone cannot guarantee admission to a gateway that restricts access to particular clients or account types.

### Telegram

Configure a BotFather `BOT_TOKEN` and comma-separated numeric `ADMIN_IDS`, then run `pansa serve`. The bot only accepts configured admins. Send questions, tasks, and attachments for analysis. Use `/memory query`, `/forget fact`, `/schedule CRON|TASK` (UTC), and `/doctor`. `/dashboard` creates a one-time sign-in link.

Replies support native Telegram formatting for Markdown bold, italic, strikethrough, inline code, fenced code blocks, quotations, lists, and links. `++underline++` is also supported. Formatting survives message splitting. Approval cards are removed after a decision; buttons are disabled if deletion fails. Questions show option descriptions, free-answer instructions when allowed, declared defaults, and resolved states.

Configure API keys through provider setup rather than ordinary chat. External actions on your behalf require explicit authorization.

### Dashboard

`pansa serve` exposes the dashboard on port `3000` and the core API/WebSocket on `3001`. Sign in with your `DASH_TOKEN` or a one-time Telegram link. The responsive dashboard includes conversation-focused chat, live action indicators, detailed Console logs, sessions, providers, tools, skills, memory, schedules, settings, dark/light themes, and reduced-motion support.

## Profile, memory, and persona

- `~/.pansa/USER.md`: name, language, time zone, preferences, important people, and current goals.
- `~/.pansa/MEMORY.md`: curated durable memory, indexed with SQLite FTS5.
- `~/.pansa/SOUL.md`: editable assistant identity, style, language, and persona.
- `~/.pansa/skills/` and `~/.pansa/plugins/`: user-managed skills and plugins.
- Episodic conversation memory is scoped to its session; durable facts can be shared across sessions and channels.
- `memory_save`, `memory_forget`, and `memory_explain` manage durable memory. Forgetting verifies database/index and document removal.

SQLite uses WAL, additive migrations, and FTS5 triggers. Backups are stored in `~/.pansa/data`. Existing profiles and explicit language preferences are preserved when updating; new profiles default to English and UTC.

## Skills and extensions

Skills are Markdown files in `skills/<name>/SKILL.md`. Included domains cover research, writing, knowledge management, reminders, coding, web browsing, bug reports, and troubleshooting. MCP servers and plugins extend the tool catalog. HTTP/SSE MCP works in host mode; isolated stdio MCP requires Docker.

## Execution modes

`EXEC_MODE=host` is the installer default. Tools run locally in the selected workspace. Shell working directories persist across calls in a session, and agent state lives in `PANSA_HOME/state`.

`EXEC_MODE=docker` runs tools in sandbox containers. Install Docker Engine and build the sandbox image first. Compose/Caddy remains an optional deployment path; Docker is not required for host installation.

## Configuration

Example environment settings:

```dotenv
PANSA_HOME=/home/user/.pansa
MASTER_KEY=<64 hexadecimal characters>
DASH_TOKEN=<random token>
EXEC_MODE=host
WORKSPACE_DIR=/home/user/projects
WORKSPACE_ALLOWLIST=/home/user/projects
PORT=3001
DASHBOARD_PORT=3000
PUBLIC_URL=https://agent.example.com
BOT_TOKEN=
ADMIN_IDS=
SCHEDULER_MODE=internal
```

Provider keys are encrypted with AES-256-GCM using `MASTER_KEY` and masked in API listings. Preserve your master key to keep existing credentials readable.

## Development and verification

```bash
npm install
npm run typecheck
npm test
npm run build
```

Core uses Fastify, grammY, SQLite WAL/FTS5, an agent loop, and a tool registry. The dashboard uses Next.js. Controls include workspace path checks, guarded public-web fetching, parameterized SQL, httpOnly cookies, constant-time token checks, encrypted credentials, and scoped approvals.

For local development, configure `.env` (see `.env.example`), run `npm run dev`, and open `http://localhost:3000`. Telegram and model requests require their respective connections to be configured.

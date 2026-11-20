# PansaOS

PansaOS is a self-hosted personal AI assistant for research, writing, and project work. Run it on your Linux server, connect your preferred model provider, and continue the same conversation from the web dashboard, Telegram, or the `pansa` CLI.

[Latest release](https://github.com/jhodypedia/PansaOS/releases/latest) · [Issues](https://github.com/jhodypedia/PansaOS/issues)

## What you can do

- **Work across channels.** Start a task on the web and resume the same session in Telegram or the terminal. Conversation history stays with the session, while durable memories and preferences are available across channels.
- **Choose your model.** Connect providers that support OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages. Discover models, test a connection before saving, and set a preferred model for a session.
- **Control agent execution.** Inspect a project in Plan mode or work on it in Build mode. Approve shell execution once or for the session, and revoke that permission when you’re done.

## Install on Linux

You’ll need **Node.js 20.19 or newer**, npm, and `rsync`. Native build tools may be needed for SQLite. The installer has been tested on Ubuntu 24.04.

```bash
git clone https://github.com/jhodypedia/PansaOS.git
cd PansaOS
./install.sh
pansa serve
```

Open `http://localhost:3000` and sign in with `DASH_TOKEN` from `~/.pansa/.env`. In **Providers → Add provider**, enter your endpoint, credentials, and model ID, then select **Test connection**. Open **Chat** to start a session and choose its preferred model.

On first installation, the installer displays the dashboard address and generated sign-in token. Updates preserve your token without printing it again.

For a managed service on a server with systemd, use `sudo ./install.sh --service` in place of the manual install and start commands. The service runs under a non-root account. For updates, check out a newer release and rerun the installer. Keep your `MASTER_KEY` so existing encrypted credentials remain readable.

## Connect Telegram or use the CLI

To connect Telegram, open **Settings → Telegram** in the dashboard or run `pansa telegram setup`. Add a BotFather token and numeric admin user IDs, test the bot, and save. Dashboard settings are encrypted and take precedence over `BOT_TOKEN`/`ADMIN_IDS` environment defaults. Restart PansaOS after saving to apply changes. In Telegram, `/start` opens the command menu, `/model` opens the model picker, and `/dashboard` generates a one-time sign-in link.

From a project directory listed in `WORKSPACE_ALLOWLIST`, run `pansa` for an interactive session or `pansa run "Explain this project"` for a single task. Use `pansa --continue` to resume your last CLI session.

## Configuration and data

PansaOS stores its database, profile, and execution state in `PANSA_HOME`, which defaults to `~/.pansa`. Set `WORKSPACE_DIR` for the default project and `WORKSPACE_ALLOWLIST` for additional project roots. For a server behind HTTPS, set `PUBLIC_URL` to the address users visit. See the [environment example](.env.example).

In host mode, shell commands run with the Pansa account’s filesystem and network permissions. The managed service adds systemd filesystem restrictions. Use Docker execution when tool commands need container isolation.

## Development

Configure a repository-root `.env` using [the environment example](.env.example), then run `npm install` and `npm run dev`. The dashboard runs on `http://localhost:3000`.

```bash
npm run typecheck
npm test
npm run build
```

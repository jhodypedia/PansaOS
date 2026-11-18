# Agent workflow update

PansaOS uses per-session settings in the existing SQLite settings table for mode,
todos, context state, and command archives. No provider configuration is changed.

Commands are Markdown files under `commands/`. The core reads them on every
command request, so new files in the deployed commands directory are recognized
without a core restart. Changes baked into the Docker image require rebuilding.

Shell commands share a Bash process inside a session sandbox. `fresh: true` uses
an isolated command instead. Interrupts/timeouts remove the container; a later
command starts a clean shell. Workspace files remain. Shells run as UID 1000,
with no Linux capabilities, no privilege escalation, no Docker socket, bridge
networking, 2 GB RAM, two CPUs and 512 processes.

Plan mode uses a conservative tool allowlist. Arbitrary Bash and all MCP tools
are blocked in Plan because read-only behavior cannot be established from an
arbitrary command or an external tool's description. Read/search/git inspection
tools remain available. Build changes require approval unless the session has
explicit auto-approval enabled. Commits, branch switches, checkpoint restores,
and executing a plan always require approval, including auto-approval sessions.

MCP stdio runs in its own sandbox container with only the session workspace
mounted. It cannot access the host Docker socket or agent checkpoint home.
All MCP calls require approval and are bound to their configured session.
Remote HTTP/SSE servers execute outside PansaOS: their own filesystem and
authorization policies cannot be enforced by the local Docker sandbox. Configure
only trusted servers and do not give them host paths or secrets. Headers are
stored encrypted and are not returned by the settings API.

Symbol tools use Universal Ctags; LSP integration is not implemented. Token
counts use a four-characters-per-token estimate; the context limit defaults to
an explicitly estimated 32,000 tokens. Provider-specific input/output usage is
not yet available separately in the provider event contract. Costs are shown
only when the configured provider has a nonzero price.

Checkpoint snapshots exclude `.git`, `node_modules`, `.next`, `.home`, `.local`
and symlinks. Restore changes workspace files but preserves repository metadata
and dependency directories. These are workspace recovery points, not VM backups.

---
name: troubleshooting
description: Troubleshoots Chrome DevTools MCP startup, page, navigation, and browser connection failures.
triggers: [chrome devtools error, chrome-devtools failed, list_pages failed, new_page failed, navigate_page failed, browser startup, DevToolsActivePort]
tools: [chrome-devtools__, read_skill, list_files, read_file]
---

# Chrome DevTools MCP Troubleshooting

When a DevTools MCP tool fails, use the exact returned error and proceed in this order:

1. Check the MCP status in the dashboard for connection errors and tool count.
2. For page-scoped tools, call `list_pages` and use a current `pageId`. Create a page with `new_page` if none exists.
3. Retry navigation with `navigate_page` using an HTTP(S) URL. `file:` navigation is disabled.
4. If startup or navigation still fails, inspect the MCP status error and container logs through the existing operator workflow. Do not print credentials or environment secrets.
5. Read the official troubleshooting guide at https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md for the matching error.

This PansaOS server launches its own headless Chrome for Testing instance. Do not recommend `--autoConnect`, a host Chrome profile, or owner login; those are not part of this isolated configuration.

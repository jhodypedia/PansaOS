---
name: chrome-devtools
description: Uses Chrome DevTools MCP for browser automation, debugging, console and network inspection, and performance analysis.
triggers: [chrome devtools, chrome-devtools, browser performance, performance trace, console errors, network requests, navigate_page, take_screenshot]
tools: [chrome-devtools__]
---

# Chrome DevTools

Use the `chrome-devtools__*` tools for browser automation, debugging, and performance work. This server runs headless with an isolated temporary profile; it has no owner login or persistent cookies.

## Workflow

1. Use `list_pages` to identify a page or `new_page` to create one.
2. Use `navigate_page` with the target URL and page ID. Use `wait_for` when waiting for a known condition.
3. Use `take_snapshot` to inspect the page and obtain element UIDs before interacting. Refresh the snapshot after navigation or substantial DOM changes.
4. Use `click`, `fill`, `fill_form`, `press_key`, and `type_text` with the relevant page ID. These actions require approval through PansaOS.
5. Use `take_screenshot` for visual inspection. Save screenshots, logs, and traces only under `/workspace` (the current session workspace).

## Performance analysis

Use `performance_start_trace`, navigate or interact with the page, then `performance_stop_trace` and `performance_analyze_insight`. CrUX integration and usage statistics are disabled. Report measurements and caveats without inventing metrics.

## Console and network

Use `list_console_messages` and `get_console_message` for browser errors. Use `list_network_requests` and `get_network_request` to inspect requests; sensitive network headers are redacted.

## Safety

- Do not sign into accounts or enter credentials unless the owner explicitly requests it for this task.
- Keep browser artifacts inside the session workspace. The server is limited to `/workspace` and cannot navigate to `file:` URLs.
- Downloads are configured to land in `/workspace`; never retrieve or expose a downloaded file without the normal PansaOS approval.
- All MCP actions require PansaOS approval and are unavailable in Plan mode. Do not bypass those controls.
- Prefer `take_snapshot` and dedicated tools over arbitrary JavaScript evaluation.

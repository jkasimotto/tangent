---
name: verify-app
description: Verify a UI change works in the live Tangent app by booting it against an isolated clone of real data and driving it in a browser. Use when asked to verify a change, confirm a fix works, check the Usage UI or Eval UI, or "does this work in the live app". Triggers on "verify", "does it work", "check the app", "drive the UI".
---

# Verify a change in the live app

Boot the real app read-only against your live `~/.tangent` data, then drive it with the `chrome-devtools` MCP. The script sets `TANGENT_VERIFY_READONLY`, which makes both apps non-writing: eval's "launch run" button is disabled (it spawns real agents and spends tokens) and usage's transcript watcher (its only writer) is off. Everything else is read-only, so live data is never modified. No copy, instant boot.

Pick the app you changed: `usage` (conversation telemetry UI) or `eval` (eval runs / comparison UI).

## Steps

1. **Boot it** (background, so you keep working):
   ```
   node scripts/verify-app.mjs <usage|eval>
   ```
   It prints one JSON line: `{ "url": "http://127.0.0.1:PORT/", "log": "/tmp/tangent-verify-…/server.log" }`. Read the `url`.

2. **Drive it** with the `chrome-devtools` MCP tools:
   - Navigate to `url`.
   - Take a snapshot/screenshot to see what rendered.
   - Click through the exact flow your change touched (the button, the view, the comparison).
   - Check the console and network panels for errors.

3. **Judge honestly.** The change is verified only if you saw it work in the rendered page. If it failed, report the exact symptom with a screenshot. "Tests pass" is not verification; seeing it work is.

4. **Tear down:** kill the background task. The temp dir (holding `server.log`) is removed automatically. If the page failed to load, read the `log` path first for boot/runtime errors.

## Running several at once
Each invocation gets its own OS-assigned port, and each agent process spawns its own isolated `chrome-devtools` browser, so you can boot `usage` and `eval` together, or run independent agents in parallel, with no interference.

---
name: verify-app
description: Verify a UI change works in the live Tangent app by booting it read-only against real data and driving it in a browser with the chrome-devtools MCP. Use when asked to verify a change, confirm a fix works, run a copy of the live app, check the Usage UI or Eval UI, or "does this work in the live app". Triggers on "verify", "does it work", "use a copy of the live app", "check the app", "drive the UI".
---

# Verify a change in the live app

Boot the real app read-only against your live `~/.tangent` data, then drive it with the `chrome-devtools` MCP. The script sets `TANGENT_VERIFY_READONLY`, which makes every app non-writing: eval's "launch run" is disabled (it spawns real agents and spends tokens), usage's transcript watcher (its only writer) is off, and trees rejects every mutation (create/delete entity). Everything else is read-only, so live data is never modified. No copy, instant boot.

Target:
- (default) `ui` boots the combined `tangent ui`, usage + trees + eval mounted together, the same app you normally run.
- `usage` or `eval` boots that single app in isolation when you only changed one.

## Steps

1. **Boot it** (background, so you keep working):
   ```
   node scripts/verify-app.mjs [ui|usage|eval]   # default: ui
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

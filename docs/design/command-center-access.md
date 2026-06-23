# Options: making Tangent a summonable command center (not just a tab)

Status: options memo (2026-06-24). Source: in-app feedback `1782253182813`. User asked for options, not action ("I don't expect them actioned, I want to know what our options are").

## The ask, reframed

> "I hate having to have this in a tab. This is meant to be a command and control center, not one of 100 tabs. Ideally there'd be a keyboard shortcut to bring this front and center, or this would be a native app."

Real need: Tangent exists to *reduce* context-switching cost, yet reaching it is itself a context switch (hunt through the tab strip). The user wants it (a) out of the tab pile with its own identity, and (b) summonable instantly with a global hotkey, regardless of what is focused.

Hard constraint: Tangent is a local web-server UI on `127.0.0.1:<port>`. A plain browser tab cannot register a global OS hotkey or leave the tab strip on its own. Every option works around that. The user is on macOS.

## Current state

- The shell is a static SPA: `packages/tangent-ui/index.html` + `assets/`, served by the combined `tangent ui` launcher via `tangentUiAssets`.
- No web manifest, no service worker, no Electron/Tauri scaffolding exists.
- The server is started by the user (`tangent ui`); the UI assumes a running local server.

## Options

| # | Option | What it gives | Tangent-side effort | Cost / risk |
|---|--------|---------------|--------------------|-------------|
| A | **PWA install** (web manifest + icons + minimal service worker; "Install app" in Chrome) | Standalone window, own dock icon, own Cmd+Tab entry, out of the tab strip | **Small** (manifest + icons + link tag in index.html; SW optional) | No hotkey by itself; depends on Chrome installability; still needs the server running |
| B | **Global hotkey via OS automation** (Raycast / Hammerspoon / skhd / macOS Shortcuts) binds a key that focuses-or-launches the Tangent window | The "front and center" hotkey | **~Zero** (config, not code) | External tool + per-machine setup; focusing a raw browser tab via AppleScript is brittle (focusing a PWA window from A is reliable) |
| C | **Tauri desktop shell** (Rust + system webview pointed at the local server) | True native app: owned global shortcut, tray icon, always-on-top, launch-at-login, own dock icon | **Medium** | Adds Rust toolchain + packaging/signing; must manage server lifecycle (spawn or bundle) |
| D | **Electron desktop shell** (Node + Chromium) | Same as C, all-JS | **Medium** | Heavy binary (~100MB+), more RAM; packaging/signing overhead |
| E | **Menubar/tray helper** (tiny native or a Hammerspoon spoon) that toggles the window | Always-present tray entry + toggle hotkey | Small–Medium | Overlaps B/C; another surface |

## Recommendation: a ladder, lowest friction first

1. **Now (Small, mostly config):** Ship a **PWA manifest** for the shell (Option A) so Tangent installs as a standalone window with its own dock icon, then bind a **Raycast or Hammerspoon hotkey** that focuses-or-opens that window (Option B). Together this delivers ~90% of the desire (out of tabs + instant summon) for a tiny, reversible tangent change plus a one-time OS setup. Focusing a PWA *app window* by name is reliable, unlike poking a specific browser tab.
2. **Later, only if it earns it (Medium):** A **Tauri** shell (Option C) for a first-class native app with an *owned* global shortcut, tray presence, and launch-at-login. Prefer Tauri over Electron: the UI is light and the server is already a separate process, so the heavy Chromium bundle of Electron buys little.

The only Tangent code for step 1 is: a `manifest.webmanifest`, a set of icons, a `<link rel="manifest">` in `packages/tangent-ui/index.html`, and (optional, for guaranteed installability) a minimal service worker. Small and contained.

## Open decisions for the user

1. Is "out of the tab strip + a focus hotkey" (PWA + Raycast/Hammerspoon) enough for now, or do you want the full native app (Tauri) sooner?
2. If native: Tauri (light, Rust toolchain) vs Electron (all-JS, heavier) vs not yet?
3. Should the native/PWA shell also *own the server lifecycle* (start `tangent ui` itself, so launching the app is the only step), or keep the server separate as today?

# Area map shows a blank black canvas

Status: diagnosed, not implemented. Date: 2026-08-29.

## What Julian sees

Open any Area map from Work. The map screen paints its header (`@root · Map`, `Work Esc`) and then nothing: no toolbar, no canvas, no "did not load" message. Screenshot: `evidence-blank-map.png`.

## Root cause

The React editor island crashes on its first render because the private view record is `null`, and the code that reads it only defaults `undefined`.

1. `GET /api/areas/canvas?area=@root` returns `"view": null`. `readAreaBoardView` in `packages/agent-shell/app/server.mjs:1306` returns `null` when no `<area>.board-v1.json` exists under `~/.tangent/agent-shell/map-state/`. No such file exists for any Area on this machine (0 of 30 files), so every map hits this path.
2. `area-canvas-routes.mjs:15` passes that `null` through unchanged as `view`.
3. `public/area-board.js:161` hands it to the editor as `options.view`.
4. `browser/area-board-excalidraw.jsx:40` runs `core.viewFromAppState(sceneRef.current.appState, options.view)` inside `useRef(...)` during the first render.
5. `public/area-board-core.js:230` declares `viewFromAppState(appState = {}, previous = {})`. A default parameter replaces `undefined` only, not `null`, so `previous.foldedGroupIds` at line 235 throws `TypeError: Cannot read properties of null (reading 'foldedGroupIds')`.
6. React 18 unmounts the whole tree on an uncaught render error. The host `[data-dedicated-area-map]` ends up with `innerHTML === ""` while `host.dataset.loaded === "yes"`, so the shell believes the map is mounted. The `.catch` in `area-board.js:176` never fires because `createRoot().render()` does not reject; the error surfaces only in the console.

Browser evidence (chrome-devtools against the live server on port 4321):

```
TypeError: Cannot read properties of null (reading 'foldedGroupIds')
  at o1 (agent-shell-map.js:8:161)            <- viewFromAppState, minified
  at NZ (agent-shell-map.js:157:17025)        <- mountAreaBoardEditor
  at area-board.js:160:21
  at mountDedicatedAreaMap (shell.js:1546)
```

DOM after opening: `{loaded: "yes", hostH: 648, canvases: [], hostHTML: ""}`. The stylesheet and bundle both load (200). The `429 Too Many Requests` lines in the same console are the gateway's duplicate-read guard from the shell refresh loop and are unrelated.

## Why tests did not catch it

- `area-board-core.test.js:78` calls `viewFromAppState(appState)` with no second argument, so the default kicks in.
- `area-board-browser.test.mjs` fixture mounts without a `view` key (`undefined`), so the real Excalidraw path passes.
- No test covers the server contract `view: null` reaching the editor. The `null` is produced by the server and only visible end to end.

The same undefined-vs-null gap also exists at `area-board-excalidraw.jsx:180` in `onChange`, so even a map that somehow rendered would crash on the first pan.

## Repair contract

Pick one fix at the boundary and add the proof. Do not paper over it in the JSX.

Required:

1. `viewFromAppState(appState, previous)` in `public/area-board-core.js` must treat `null` like a missing view. Simplest: `const base = previous ?? {}` and read from `base`. Keep the exported shape unchanged.
2. Unit test in `area-board-core.test.js`: `viewFromAppState(appState, null)` returns the same record as the no-argument call.
3. Browser test in `area-board-browser.test.mjs`: the fixture must mount with `view: null` (the real server value) and still reach `.excalidraw canvas.interactive`.
4. Rebuild the bundle (`npm run build -w @tangent/agent-shell` runs `app/build-browser.mjs`) and restart the Agent Shell on 4321, then open a map from Work and confirm the toolbar and canvas appear and `Saving…` then `Saved` shows after one pan.

Strongly recommended, so the next crash is visible instead of black:

5. Wrap `<TangentMap>` in a React error boundary inside `mountAreaBoardEditor` that renders the existing "The drawing tools did not load." section with the error message and a Retry button, mirroring the promise-rejection path in `area-board.js:176`. Today a render error leaves an empty host with `data-loaded="yes"`.

Optional, defensible either way: have `area-canvas-routes.mjs` emit `view: undefined` (omit the key) instead of `null`. This does not remove the need for fix 1, since `POST /api/map-state` clients and older payloads can still carry `null`.

## Files

- `packages/agent-shell/app/public/area-board-core.js:230-239` (fix)
- `packages/agent-shell/app/browser/area-board-excalidraw.jsx:40,180` (call sites)
- `packages/agent-shell/app/area-canvas-routes.mjs:15`, `server.mjs:1306-1312` (source of null)
- `packages/agent-shell/app/area-board-core.test.js`, `area-board-browser.test.mjs` (proof)

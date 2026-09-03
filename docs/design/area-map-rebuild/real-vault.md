# The rebuilt Map on a copy of the real vault

The last proof of the Map rebuild: Julian's real Area geometry, loaded by the unmodified production server into the rebuilt browser Map. Design: `code.md`. This run never touched `~/.tangent/trees` and never bound port 4321.

## What was loaded

A copy of `~/.tangent/trees` at vault commit `fcbe2b02`, 44 MB, 1,865 Markdown files, placed under a throwaway `HOME`.

| Measure | Value |
|---|---|
| Areas the world reports (`controller.world().areas.length`) | 56 |
| Areas the server reports (`/api/areas/map-world`) | 56 |
| Region elements in the composed scene | 56 |
| Region elements Excalidraw holds, whole world | 56 |
| Areas with no rendered region | 0 |
| Areas whose shard failed to read | 0 |
| Elements Excalidraw holds in total | 68, being 56 regions and 12 authored elements |
| Page errors thrown | 0 |

Time from `page.goto` on a cold server, at 1440 by 1000:

| Moment | Time |
|---|---|
| The Excalidraw canvas exists | 286 ms |
| The first Area region is drawn | 296 ms |
| All 56 regions are drawn, after Only was lifted | 3.36 s |

The Map opens with the shell's `Only <Area>` restriction on, because a controller with no saved view restricts to the located Area (`public/area-map-world-controller.js:182`). In that state the Map drew 6 regions and hid 50, which is the product rule working. The 56 by 56 result above is the whole world with the restriction lifted.

## What was done

1. Copied the vault into the scratch directory. Every path the server writes (`HOME`, `WORKSPACE`, and each `TANGENT_*_ROOT` and `AGENT_SHELL_*` variable named in `area-map-resources-server-browser.test.mjs`) was redirected under that directory.
2. Started `app/server.mjs` on a free loopback port with `TANGENT_AREA_MAP_WORLD=1`, `AGENT_SHELL_NO_OPEN=1` and `AGENT_SHELL_TEST_NO_LAUNCH=1`, then polled `/api/health`.
3. Opened `/?area=otto%2Ftangent` in Playwright chromium at 1440 by 1000 and waited for `.excalidraw canvas.interactive`.
4. Read the mounted Map through its own React props: the controller for `world()` and the snapshot, and the host bridge for `rendered()`, which is what Excalidraw holds. The shell exposes no global handle to the Map, so the probe walks the fiber chain above `[data-tangent-area-map]` to the props the Map was mounted with.
5. Clicked the shell's `Only tangent` button to see the whole world. It did nothing, so the run lifted the restriction with `controller.setRestriction(null)` and waited for the region count to reach the Area count.
6. Fitted the world with Excalidraw's own zoom to fit, then opened the Resources panel for `otto/tangent` and the Outline.

## Evidence

- `evidence-real-vault.png`: the whole world, 56 regions, at the smallest zoom the canvas offers.
- `evidence-real-vault-resources.png`: the Resources panel for `otto/tangent`, with the control row, the save pill and the toast moved clear of the panel.
- `evidence-real-vault-outline.png`: the Outline over the whole world, 62 rows, being the 56 Areas plus the 6 Blocks whose shards were loaded.

No vault file was written during the run. The only file in the copy with a later modification time is `.git/index`, refreshed by a `git status` the run itself made.

## What looked wrong

**The `Only <Area>` button cannot turn Only off.** This is a regression against `45a68759` and it is the one real defect this run found. The shell's button is pressed, the Map announces "Whole map", and the restriction stays on. The cause is a return value. `public/area-board.js:218` reads `editor?.toggleRestriction?.(area) ?? authority.toggleRestriction(area)`. The rebuilt bridge returns nothing (`map/map-root/use-map-effects.ts:303` calls a command that returns `void`), so the `??` falls through and toggles the same restriction a second time on the controller, putting it straight back. The old component returned the controller's result object (`area-map-world.jsx:1809` at `45a68759`), so the fallback never ran. The fix is to return the result from the bridge. Every other method on that handle with a `?? authority.…` fallback returns a value today, so this is the only one affected, but the shape is worth a test.

**The whole world does not fit on screen.** With 56 Areas the world is larger than a 1440 by 1000 window at 10 percent zoom, which is the smallest zoom Excalidraw allows, so zoom to fit still leaves the top and the bottom outside the window. This is not new and not a rebuild defect, but it is the first thing a person sees at Julian's real scale.

**Area name pills collide at low zoom.** In `evidence-real-vault.png` several pills sit on top of each other, for example `pgande` under `standards` and `viz-input` over `records`. The names are unreadable where Areas are close together. The pills are drawn at a fixed size regardless of zoom, so the crowding gets worse the further out a person zooms.

**The header reads "Work data delayed · reconnecting".** `/api/work` returns 404 because it belongs to `app/gateway.mjs`, which this proof does not boot. It is not a Map problem and it does not touch the canvas.

The Resources panel for `otto/tangent` lists no resources, because the copied vault has no `map-resources.json` for that Area. It still showed its Legacy resources to review row and its Suggestions row, both read from the copy.

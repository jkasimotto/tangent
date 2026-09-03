# Agent Notes

Purpose: every sentence a person reads on the Map, one file per surface, re-exported by `../copy.ts`. Feature code imports `../copy.ts`, never a file here. Design: `docs/design/area-map-rebuild/code.md`, section "Copy".

Local rules:

- A string is byte-identical to what the old component printed; the browser suites match on them ("Place a Tangent block", "Map keys", "Map resources · ", "Find on the map", "Back to resources", "Area hierarchy", "Map save status"). Change a word only when a Goal asks for it.
- A sentence with a parameter is a method on its surface object, typed with the brands from `../units/`: a count is `Count`, a zero-based position is `Index`, a name is `string`. A sentence with keys set inside it is a `KeyedText` from `keyed-text.ts`; the kit renders each `{ key }` as `<kbd>`.
- `errors.ts` is the one place a failure kind becomes words. `copyForFailure(kind)` returns a headline and a next step and never prints the kind: a known kind has its own row, an unknown kind falls back to the operation its first word names, and the last fallback names the Map. Add a row when a new server code reaches the browser.
- Announcements live in `announcements.ts` unless the same sentence is also a dialog's message, in which case it lives with the dialog in `recovery.ts` and is spoken from there.
- No em dashes. Full sentences. No JSX here: these are `.ts` files, and the copy-confinement lint keeps multi-word JSX text out of every other feature file.

Files: `keyed-text.ts` the key-in-sentence type; `toolbar.ts` the toolbar and the kinds notice; `area-labels.ts` the name pills and accessible Area names; `save.ts` the save pill and draft choice; `find.ts`; `picker.ts`; `outline.ts`; `help.ts`; `placement.ts`; `resources-panel.ts` the panel and one inventory row; `resource-details.ts`; `resource-editor.ts` the draft form and the inventory controls; `discovery.ts` discovery, Suggestions and legacy review; `recovery.ts` the recovery dialogs and the transaction veil; `announcements.ts`; `errors.ts`; `debug.ts` the diagnostics aside.

Read next:
- `../AGENTS.md`
- `docs/design/area-map-rebuild/code.md`

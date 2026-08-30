# Area big picture: mockup of "show me Neara"

Interactive mockup of `~/.tangent/trees/otto/tangent/design-area-big-picture.md`, sections 5 to 11. No production code is touched; the page imports a pure core (`big-picture.mjs`) over a sample Neara subtree with realistic outcomes (PG&E autodesign approval, structure diff retest, Standards and Portland proof before US Monday, megabranch and viz-input handoff to Sahan and Sami).

What it demonstrates:

- One brain composes the picture. The Neara brain reads every descendant Area's notes and presents most panels itself. Where a child has its own brain (Standards, Essential/Autodesign, viz-input) that brain's panel wins on its Area and the parent's disagreement shows dim beside it.
- A panel is outcomes in a closed vocabulary: signal, next move, who, by (a date and the words it came from), evidence, relations, unsure, source. `source: brain` draws the `not in a note yet` mark.
- Child rows show the top line only, sorted needs you, waiting, stuck, moving, quiet, no brain. A Check it Goal shows without a brain because Tangent owns that fact.
- `Tangent sees` sits under every picture and never merges with the brain's claims.
- Drill (`Enter`) into any Area, `Esc` back with the cursor kept, `⌘K` Go To by name.
- Ask (`a`) and correct (`c`) open a composer quoting the element; the element shows `waiting for the brain` and never changes itself.
- `:` actions: `Do it` first when Julian holds the move, `nudge <who>` otherwise; open source, message, enter brain, copy. One press on an option approves it.
- `g` relations view draws cross-Area needs / feeds / same as / shares edges from the declared relations. Nothing else.
- `s` starts a brain on a fallback row. Every verb is a footer button with its key printed; `?` prints the sheet.

## Open

    cd prototypes/area-big-picture
    python3 -m http.server 4398

Then open http://127.0.0.1:4398/ (ES modules, so it needs a server, not `file://`).

## Verify

    node --test prototypes/area-big-picture/

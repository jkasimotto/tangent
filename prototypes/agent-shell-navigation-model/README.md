# Agent Shell unified navigation model: mockup

Interactive mockup of `docs/design/agent-shell-navigation-model/design-record.md`, sections 3.1 to 3.6. No production code is touched; the page imports a pure core (`navigation-model.mjs`) over a sample vault.

What it demonstrates:

- One object tree: Area > Brain / Goal > Assignment > Attempt, plus Documents. Assignment and Attempt rows are cursor-addressable.
- One cursor: `j/k` and arrows are synonyms, `h/l` walk the tree, `gg/G`, `{`/`}` jump, a click moves the same cursor.
- Object-generic verbs: `Enter` (go into the live thing), `o` (read), `x` (status), `:` (all commands), `a` (new child), `?` (key sheet). Stop and restart an agent are `x` choices on Assignment and Attempt rows; change harness is the `c` choice on an Attempt.
- One layer stack: Escape and the Back button pop the top layer and restore the opener's cursor. Every verb has a visible control showing its key.
- Go To (`⌘K` or `k`): indexes every object including assignments and live sessions; arrows move while typing.

## Open

The page uses ES modules, so serve the directory instead of opening the file:

    cd prototypes/agent-shell-navigation-model
    python3 -m http.server 4399

Then open http://127.0.0.1:4399/.

## Verify

    node --test prototypes/agent-shell-navigation-model/

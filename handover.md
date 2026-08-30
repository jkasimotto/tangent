# Handover: Agent Shell unified navigation model

Date: 2026-08-27. Session: design investigation, no code written.

## What Julian asked

Take stock of everything in Agent Shell (built up ad-hoc by feature requests over time). Use the design skill to map the workflow, UI, UX, every action and state transition. Design one unified navigation model that embraces both keyboard and mouse. Guiding principle: keyboard first, Vim/Neovim-grade latency between intention and action. Named intentions: enter the worker agent, enter the brain, stop or restart an agent in the pipeline, change an agent's harness, jump around freely. Underpinning model matters: what is a Goal, where is its information stored, the tmux session key. No code yet.

## What was produced

- `docs/design/agent-shell-navigation-model/design-record.md` — the full engineering record (problem contract, inventories, precedents, candidate designs, decisions, rejected alternatives, risks).
- `docs/design/agent-shell-navigation-model/user-intent.md` — Julian's request preserved verbatim-ish, following the work-contract convention.
- This file.

## Key findings from the stock-take

### The product is mid-unification already

- ADR-0038 (accepted 2026-08-27) established keyboard ownership: one visible surface owns each key, priority modal > Go To > document peek > terminal session > transient > focus picker > text entry > work/document view > screen. Implemented in `packages/agent-shell/app/public/keyboard-context.js`.
- One Work command registry exists (`public/work-commands.js`): id, key, scope, label, help, aria-keyshortcuts. Keyboard dispatch and pointer teaching both read it.
- The governing design is `docs/design/agent-shell-work-contract/design-record.md` (974 lines, decisions 1-47) plus its `user-intent.md`.
- The current uncommitted working tree (~22 files, +1680/-661) implements amendment decisions 28-42: h/l tree walk, state-owned action modals, Park status, Goal reader, pending-assignment editor, atomic Change agent.
- This is the fourth unification attempt. Prior three (editable keymap 08-07, "one tree everywhere" 08-09, flat global keymap table 08-19) all regrew. Lesson: registries with ownership survive; keymaps alone don't. `725e619` added a governance lint that refuses the return of deleted builders — the first anti-regrowth mechanism.

### Remaining mess (specific, not diffuse)

- Dead views never assigned: `agent`, `describe-agent`, `program-session`; unreachable agent decision view and What-happened overlay; `ask-core.js` unimported (kept for ADR-0033 audit window); ~20 pointer routes handled but never rendered.
- Four competing return-point mechanisms; three independent `gg` chord timers; two text-entry detectors; two Tab traps; two comment cursors.
- Two parallel Work row navigations that can disagree: `j/k` moves `state.workCursor`; arrow keys move DOM focus only; mouse click sets cursor without paint/focus.
- No Escape route from `areas` or `prompts` views. Area map adds its own document keydown listener per visited Area (accumulates, double-handles Escape).
- Registry drift: hardcoded gg/G behavior, `editAssignments` not in registry, a toast advertising a nonexistent `c` binding.
- Letter collisions between sibling contexts (d, r, n, a mean different things in Work vs modal vs launch popover).

### Domain model (where Goal information lives)

- A Goal = one Markdown file `~/.tangent/trees/<area>/goal-<slug>.md`. Vault git owns title, done_when, status (`open/done/dropped/parked` writable, `active` machine-owned), session binding, subgoal/dependency links.
- The queue (routes still say "pipeline") = one JSON per Goal at `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `area-goal-queue.v2`: assignments with instruction, launch {harness, model, effort}, status, attempts, reports, revisions, idempotency keys. Controls: start, advance, skip, end, append, edit/mutate pending suffix, replace attempt, guarded recovery. Restart and send-on are gone (410).
- Brains: one logical record per Area (`area-brain.v3`), lifecycle only active/inactive, generations as attempts.
- The tmux session name is the join key across everything: Goal frontmatter `session:`, assignment `session`, brain generation `session`, and the terminal WebSocket `/term?session=<name>`. No SQLite anywhere; runtime state is JSON under `~/.tangent/agent-shell/`.
- Launch = harness/model/effort concatenated; registry in vault `harnesses.md`; per-Area defaults in the Area note; changeable per-step, per-attempt (Change agent), per-Area default, or registry-wide.
- Three synonym vocabularies coexist (node/outcome, Area/Goal, pipeline/queue/assignment) — new work should say Goal queue / assignment and translate at edges.

## The designed model (summary; full detail in the design record)

Four parts. Everything is: move the cursor to an object, apply a verb, maybe enter a layer, Back out. Mouse and keyboard are two encodings of point / act / dismiss.

1. **Object tree as spine**: Area > Brain / Goal (recursive) > Assignment > Attempt, plus Definitions, Programs, Documents. Only new addressability: assignment and attempt rows under an expanded Goal — exactly where stop/restart/change-harness intentions land.
2. **One cursor, one idiom**: j/k and arrows synonyms on every list (arrows only where a text input owns focus); h/l tree walk everywhere; gg/G, {/}; click moves the same cursor as keys; retire the parallel DOM-focus row navigation.
3. **Object-generic verbs** in the existing registry with per-object availability: Enter = go into the live thing (or the editor that makes it live), o = read, x = lifecycle/status, `:` = scoped command menu, a = new child, ? = registry-generated key sheet. "Restart an agent" = replace-attempt (the domain's only restart); "change harness" = same verb, different launch.
4. **One layer stack + one back router**: collapse the four return mechanisms into the already-decided surface-registration contract; give areas/prompts Back parents; move the Area map into owned dispatch; Go To (⌘K) indexes assignments and live sessions too.

Plus: delete the dead surface set with an anti-regrowth lint; product-wide mouse parity (every row a pointer target, every verb a visible control showing its key, menus rendered from the registry only).

Rejected: full Vim modes / command line (a second command language next to tmux, forbidden by ADR-0038; the grammar delivers the latency), URL/browser-history Back (weaker than the decided one-layer/one-parent contract), per-surface bug fixing (historically regrows).

## Open questions / next steps

- For Julian: should Enter on a Goal with no live worker open the launch editor (today's decision 36 behavior) or the Goal reader first? Record keeps launch editor; `o` reads.
- The design layers on the uncommitted decisions-28-42 work; commit that first, then implement this in slices (suggested order: consolidation of return/chord/trap engines, dead-code deletion, assignment rows + verbs, Go To session rows, mouse parity sweep).
- Dead-code deletion must respect the ADR-0033 two-release audit window for `ask-core.js`.

## Sources to re-read on pickup

- `docs/design/agent-shell-navigation-model/design-record.md` (the full record)
- `docs/design/agent-shell-work-contract/{design-record.md,user-intent.md}`
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md`; ADR-0022/0023/0024/0031/0033/0034/0035/0036/0037
- `packages/agent-shell/app/public/{keyboard-context.js,work-commands.js,shell-event-bindings.js,shell-state.js}`
- Tests pinning conventions: `keyboard-ownership-ui.test.mjs`, `focus-shell-work-navigation-ui.test.mjs`, `work-table-ui.test.mjs`

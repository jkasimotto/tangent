# ADR-0059: Hold the browser Map to a lint-enforced engineering bar

Status: Accepted

Date: 2026-09-03

## Context

The Map usability audit confirmed 39 defects. Twenty-two sat in one 3,273-line React component that owned pointer gestures, every surface, keyboard handling, toasts and the camera. Four causes explained most of them: one component owned the whole Map, two systems owned pointer input with no explicit handoff, nothing proved that minted values satisfied the guards applied to them, and layout constants were copied rather than named.

Review notes and module guides had not stopped those causes. Each was a rule that an agent could forget in the next commit.

Julian's otto-dnd project holds the same class of code to a bar that is enforced by lints rather than by review: no raw `number` type, function and module size caps, confinement of CSS, positioning, keyboard input and DOM construction to named owners, and duplicate detection with jscpd. He asked for that bar here.

## Decision

The browser Map is rebuilt in TypeScript under `packages/agent-shell/app/map/` to the design in `docs/design/area-map-rebuild/code.md`, and that directory is held to the following bar by scripts under `scripts/lint/`, run on staged files by the pre-commit hook and on the tree by `npm run lint`.

- Every numeric value carries a unit or a semantic brand. The raw `number` type appears only in `app/map/units/`. A numeric literal other than 0, 1 and -1 appears only in `units/` and `layout/layout-tokens.ts`.
- No function exceeds 80 lines, no module exceeds 400 lines, no function takes more than 7 parameters, and no production `any` exists.
- One function decides what a pointer press means. Excalidraw's selection is written from input in one module. Excalidraw's pointer props are wired in one component. Host key listeners exist in one dispatcher.
- Every surface is declared once in a registry and rendered through one kit component, which alone renders dialogs, backdrops and focus moves.
- CSS, positioning, z-index, raw colours and raw interactive elements are confined to `app/map/ui/`, with colours in `tokens.css` and the z-index scale in `layers.css`.
- The kernel under `app/public/` is imported only through `app/map/kernel/`.
- Every user-visible sentence lives in `copy.ts`. Every `*-store.ts` is a pure reducer.
- Every value the server mints and later guards is registered as a minter-and-guard pair in `app/public/area-map-wire-values.js`, and one property test proves every pair.
- jscpd blocks duplicated code in the Map scope at 45 tokens.

A new lint follows the existing pattern: a Node script over the TypeScript AST, a `--staged` mode, a `--root` mode for tests, and a `GRANDFATHERED_FILES` ratchet that burns down to empty. The Map scope is never grandfathered.

## Consequences

An agent cannot commit Map code that duplicates a helper, retypes a number, inlines a style, adds a key listener, renders a dialog itself, or reaches the kernel directly. The four causes the audit found are unrepresentable rather than discouraged.

The kernel under `app/public/` keeps its JavaScript and its tests. The type-based lints do not cover it until it is converted, which is a separate Goal.

The lint pool must stay fast, because it runs on every commit. Whole-repository work stays out of the staged path.

## Rejected alternatives

Splitting the old component into smaller files without the lints. The audit's fixes had already done this in places, and each new surface still forgot the panel inset.

Writing the rules into the module guide only. That was the state before the audit.

Converting the kernel in the same change. The audit refuted eight findings because the kernel already handled the case, and its property tests are the model the rest follows.

## Related decisions

- ADR-0051 defines the composed world and the transaction boundary the Map keeps.
- ADR-0052 defines the layout kernel the Map keeps.

# Eval Context Builder Design

**Date:** 2026-06-29
**Status:** Approved (brainstorming → ready for plan)
**Surface:** Tangent Eval compare screen (`@tangent/eval-ui`), backed by `@tangent/eval` server.

## Goal

On the Eval compare screen, add an **Assembled** view to the Context section that reconstructs the exact repo-contributed context a coding agent would see when it starts in a chosen directory of a variant's frozen worktree, with a chosen set of skills loaded. The view renders the literal concatenated text, in Claude's real load order, side by side for variant A and variant B, with provenance markers and difference highlighting. Also make the Context section scrollable.

## Why

The current "Context files" section is a raw git-blob diff of every file matching context patterns (`CLAUDE.md`, `AGENTS.md`, `.claude/`, ...) across the whole repo. It misrepresents what the agent actually loaded:

- It lists ~30 `.claude/agents/*.md` subagent files as "context," but a subagent's body never enters the main agent's context (only its metadata, for routing).
- It lists `AGENTS.md` as independently loaded, but Claude Code reads `CLAUDE.md`, not `AGENTS.md`. `AGENTS.md` enters context only when a `CLAUDE.md` imports it via `@AGENTS.md`.
- It ignores cwd and the CLAUDE.md hierarchy entirely.
- It shows skill files as opaque blobs, with no notion of "frontmatter always loaded, body only on invoke."

Users comparing eval variants (e.g. "empty context" vs "repo context") need to see what each agent genuinely saw, and to explore how that context changes with cwd and loaded skills.

## How Claude assembles context (the model we reproduce)

Verified against code.claude.com docs (memory, skills, sub-agents, settings). We reproduce only the **repo-contributed** portion (see Boundaries).

1. **CLAUDE.md chain.** Walk up from cwd to the repo root; concatenate root → cwd (root first, cwd last). At each directory level, `CLAUDE.md` then `CLAUDE.local.md` (if present). `CLAUDE.md` files *below* cwd do **not** load at start; they load lazily when the agent reads a file in that subtree.
2. **@imports.** Inside a CLAUDE.md, an `@path` token (outside backticks and fenced code blocks) expands the referenced file's content inline. Relative paths resolve against the importing file's directory. Recursion depth max 4 hops. This is how `AGENTS.md` enters context (via `@AGENTS.md`).
3. **Skills.** Every discoverable skill contributes its frontmatter (`name`, `description`, `when_to_use`) at start. The full `SKILL.md` body loads only when the skill is invoked. Discovery (repo scope): `**/.claude/skills/<name>/SKILL.md` in the worktree.
4. **Subagents.** `**/.claude/agents/*.md`: only metadata (`name`, `description`) is used for routing. The body becomes the subagent's own system prompt on spawn; it never enters the main agent's context.
5. **settings.json:** not context. Excluded.

## Boundaries (explicit non-goals)

- **No base system prompt.** Anthropic's base Claude Code system prompt is not in the repo and is not reconstructed.
- **No user-global or managed scope.** `~/.claude/CLAUDE.md`, `~/.claude/skills`, plugin skills, and managed policy live outside the eval's frozen worktree and are out of scope. The view is labeled "repo-contributed context."
- **Read-only.** No editing of context; preview only.
- **Repo skills/subagents only**, discovered from the worktree at the variant's context ref.

## Surface and UX

The Context section header gets a segmented toggle: **`Files | Assembled`**.

- **Files**: today's flat diff list, unchanged in content, now scrollable.
- **Assembled**: the new builder.

### Assembled view layout

```
┌ Context  [ Files │ Assembled ]──────────────────────────────────────────────┐
│  cwd: [ client/lib/src/model/expr____ ]  skills: [+ pick ▾]  [⧉ copy A][⧉ B] │
│  A · haiku-no-ctx              │  B · haiku-repo-ctx                          │
│  (no repo context at this path)│  ┌─ /CLAUDE.md ──────────────────────────┐  │
│                                │  …verbatim…                               │  │
│                                │  ┌─ /client/CLAUDE.md ───────────────────┐  │
│                                │  …verbatim…                               │  │
│                                │  ┌─ @AGENTS.md (imported by /CLAUDE.md) ──┐  │
│                                │  …verbatim, expanded inline…              │  │
│                                │  ┌─ Skills index (frontmatter, always) ──┐  │
│                                │  expression-functions, "Use when…"       │  │
│                                │  ┌─ SKILL: testing (body, loaded) ───────┐  │
│                                │  …full skill body…                        │  │
│                                │  ┌─ Subagents (metadata only) ───────────┐  │
│                                │  correctness-reviewer, "…"               │  │
│  ▸ Below cwd, loads lazily (not at start): client/.../sub/CLAUDE.md         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Controls (shared across both columns)

- **cwd**: free-text path input, relative to the repo root (e.g. `client/lib/src/model/expr`). Empty = repo root. Resolves the upward CLAUDE.md chain. Changing cwd re-assembles both columns.
- **skills loaded**: a multi-select picker listing every skill discoverable in either variant (union). Checking a skill includes its full body in both columns (where that skill exists). Default: none loaded. Frontmatter for all discoverable skills always appears regardless.
- **copy A / copy B**: copies that column's verbatim concatenation (the real bytes, without the `┌─ source ─┐` provenance dividers).

### Rendering details

- Each block is the **verbatim** file content. The only thing the UI adds is the `┌─ source ─┐` provenance divider above each block; dividers are UI chrome, never part of the copied text.
- Block order per side follows the load model: CLAUDE.md chain (root→cwd, each with its imports expanded in place), then Skills index (frontmatter), then loaded skill bodies, then Subagents (metadata).
- **Difference highlighting**: blocks are compared by `source` (grouped, so a CLAUDE.md split into segments around imports compares as one source). A source present on only one side is marked left-only / right-only. A source present on both with differing text gets a line-level diff (reusing the existing `diffLines` add/remove rendering). Identical sources render plain.
- **Below-cwd CLAUDE.md** are listed by path in a separate "loads lazily, not at start" footer, not concatenated.
- Empty side (no repo context at that path) shows a clear empty state, not a blank column.

### Scroll fix

The Context section body scrolls within the panel instead of pushing the page past the viewport. Applies to both Files and Assembled views. Implementation diagnoses the actual constraining element in the **combined `tangent ui`** shell (the embedded eval mount may not establish a bounded height down the `.compare-shell` → `.compare-stack` flex chain) and fixes it so a 40-row Context section scrolls internally. Verified live in `tangent ui`, not only per-app.

## Architecture

### Package boundaries

- **`@tangent/eval`** (core + server): all assembly logic. Reads the variant worktree at its context ref via existing `@tangent/repo/git` helpers (`showFile`, `fileOidsAtRef`). No new git/worktree helper duplication.
- **`@tangent/eval-ui`**: the Assembled view and a client method. Must not import `@tangent/eval`; talks to `/api/eval/*` only. API types are serializable and mirrored locally.

### New core module: `packages/eval/src/core/context-assembly.ts`

Pure functions operating on a "file reader at ref" abstraction so they are unit-testable without git:

```ts
// A minimal reader the assembler depends on (injected; real impl wraps showFile/fileOidsAtRef).
export type ContextSource = {
  listFiles(): Promise<string[]>;                  // all repo-relative paths at the ref
  read(path: string): Promise<string | undefined>; // file content at the ref, or undefined
};

export type AssembledBlock = {
  kind: "claude-md" | "import" | "skills-index" | "skill-body" | "subagents-index";
  source: string;   // repo-relative path, or synthetic label for index blocks
  text: string;     // verbatim content (for index blocks: the rendered index text)
};

export type SkillEntry = { name: string; description: string; path: string; loaded: boolean };
export type SubagentEntry = { name: string; description: string; path: string };

export type AssembledContext = {
  blocks: AssembledBlock[];
  skills: SkillEntry[];          // all discoverable, with loaded flag
  subagents: SubagentEntry[];    // all discoverable (metadata only)
  lazyClaudeMd: string[];        // CLAUDE.md paths below cwd (not concatenated)
};

export async function assembleContext(
  source: ContextSource,
  cwd: string,                   // repo-relative; "" = root
  loadedSkills: string[]         // skill names whose bodies to include
): Promise<AssembledContext>;
```

Helpers in the same module (each its own named function, unit-tested):

- `claudeMdChain(allPaths, cwd)`: returns the ordered list of in-chain CLAUDE.md/CLAUDE.local.md paths (root→cwd), plus the below-cwd list.
- `expandImports(source, path, text, depth)`: finds `@path` tokens not inside backticks/fenced code blocks; resolves each relative to `path`'s directory; recurses to max depth 4 with a visited set (cycle/dup guard). It **splits the parent text around each token and emits the imported file as its own adjacent `import` block in the token's position** (the token line is replaced by the imported content). Concatenating the resulting blocks in order therefore reproduces the agent's exact view (token → content), while each provenance divider falls on a natural block boundary. Returns the ordered block segments.
- `parseFrontmatter(text)`: extracts `name`, `description`, `when_to_use` from a leading `---` YAML block using minimal key/value parsing (no YAML dependency). Single-line scalar values; quoted values unwrapped. Missing block → empty fields.
- `discoverSkills(allPaths)` / `discoverSubagents(allPaths)`: filter `**/.claude/skills/*/SKILL.md` and `**/.claude/agents/*.md`.

### Server (`packages/eval/src/server/index.ts`)

Two endpoints:

- `GET /api/eval/runs/:runId/context/manifest?caseId=&variant=` → `{ skills: SkillEntry[], subagents: SubagentEntry[] }` for that variant (frontmatter only; `loaded` always false here). Used to populate the skill picker and counts without assembling. The UI requests it per variant and unions the skill lists for the shared picker.
- `GET /api/eval/runs/:runId/context/assemble?caseId=&variant=&cwd=&skills=a,b` → `AssembledContext`. `skills` is a comma-separated list of skill names to load.

Both build a `ContextSource` over the variant's worktree at its context ref (`contextCommit`, falling back to `baseCommit`, mirroring `showContextFile`). `listFiles` wraps `fileOidsAtRef`; `read` wraps `showFile`.

### Client (`packages/eval-ui/src/client.ts`)

Mirror `AssembledContext`, `AssembledBlock`, `SkillEntry`, `SubagentEntry` as local serializable types. Add:

- `getContextManifest({ runId, caseId, variant }): Promise<{ skills; subagents }>`
- `assembleContext({ runId, caseId, variant, cwd, skills }): Promise<AssembledContext>`

### Assembled view (`packages/eval-ui/src/`)

A focused component (e.g. `AssembledContext.svelte`) mounted inside the Context section when the toggle is on `Assembled`. App.svelte owns the toggle state and the shared controls (cwd, loaded skills); the component renders the two columns. State: `contextView: "files" | "assembled"`, `assembleCwd: string`, `loadedSkills: Set<string>`. On any control change, fetch `assembleContext` for left and right variants (in parallel) and render. Difference highlighting compares the two `AssembledContext` block lists by `(kind, source)`.

## Data flow

1. User toggles Context → Assembled. UI fetches `context/manifest` for A and B, unions skills to populate the picker.
2. UI fetches `context/assemble` for A and B with current cwd + loaded skills.
3. Server builds a `ContextSource` per variant at its context ref; `assembleContext` produces ordered blocks + skill/subagent metadata + lazy list.
4. UI renders two columns of verbatim blocks with provenance dividers, marks present-only / changed blocks, line-diffs changed text blocks, lists lazy CLAUDE.md, and copies verbatim concatenation on demand.

## Error handling

- Missing variant / case / run → 404 with a clear message; UI shows an inline error in the Context section, not a crashed view.
- A referenced `@import` target that does not exist at the ref → rendered as a visible `@path (not found)` marker in place, assembly continues.
- `@import` recursion beyond depth 4 or a cycle → stop expanding, leave a `@path (max import depth)` / `@path (cycle)` marker; assembly continues.
- cwd path that does not exist in the worktree → still resolves the chain from whatever ancestor CLAUDE.md exist; if none, the side shows the empty state. Never errors on a nonexistent leaf dir.
- A worktree whose context ref is unreadable → 404-style error surfaced inline.

## Testing

- **Core (`packages/eval/test`)**, node --test, with an in-memory `ContextSource`:
  - `claudeMdChain`: ordering root→cwd; CLAUDE.local.md pairing; below-cwd partition; root-only when cwd is `""`.
  - `expandImports`: inline expansion; relative resolution; ignores `@` inside backticks and fenced blocks; depth cap at 4; cycle guard; missing-target marker.
  - `parseFrontmatter`: name/description/when_to_use; quoted values; missing block.
  - `assembleContext`: end-to-end block order; skills frontmatter always present; loaded skill body included only when requested; subagents metadata only; lazy list populated.
- **Server (`packages/eval/test/eval.test.mjs`)**: `assemble` endpoint over a prepared fixture returns blocks for the context-bearing variant and an empty block list for the empty-context variant; `manifest` returns the discoverable skills/subagents.
- **UI (`packages/eval-ui/src`)**, vitest + testing-library:
  - Toggle switches Files ↔ Assembled.
  - Both columns render from a faked `assembleContext`; provenance dividers present; copy emits verbatim text without dividers.
  - Changing cwd re-fetches both sides.
  - Loading a skill includes its body block.
  - Present-only block marked; changed block line-diffed.
- **Live verification in `tangent ui`**: Assembled view renders for the real `context-vs-no-context-haiku` run; cwd change updates both columns; Context section scrolls; no console errors.

## Docs to update

- `packages/eval/docs/index.md`, `docs/architecture.md`, `docs/public-api.md`: new context-assembly module and endpoints.
- `packages/eval-ui/docs/index.md`, `docs/architecture.md`: the Assembled context view.

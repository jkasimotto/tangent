# area-skills: organise personal agent skills and how-to knowledge per Area in the Tangent vault, so brains see them and hand them to workers; a chain of skills is a pipeline

## Observed

## 1. Where a brain, a worker, and a describe-work session start (cwd)

**Observed.** One helper decides the directory for every spawn: `areaDirectory(area)` in `packages/agent-shell/app/server.mjs:466-471`. It reads the Area note's `## Resources` section for a line `- Repository: <path>` or `- Worktree: <path>` (`areaResource(area, "Repository|Worktree")`), expands `~`, and returns `null` when the line is absent or the directory does not exist. `packages/agent-shell/app/programs.mjs:44-58` (`programDirectory`) is the same regex for Programs: `/^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$/mi`.

- Brain: `spawnBrainSession` at `server.mjs:4804`: `const directory = (await areaDirectory(record.area)) ?? path.join(TREES_ROOT, record.area);` then `server.mjs:4839` `createOwnedTmuxSession(name, ["-d", "-s", name, "-c", directory])`. So a brain starts in the bound repository when the Area note declares one, otherwise in the Area folder inside the vault (`~/.tangent/trees/<area>`). It never starts in the Tangent repository as such; the otto/tangent brain does only because `~/.tangent/trees/otto/tangent/tangent.md` `## Resources` has `- Repository: ~/Projects/otto-tangent`.
- Worker (Goal session and every pipeline step): `spawnGoalSession` at `server.mjs:2269`, directory at `server.mjs:2339`: `const dir = workingDirectory || (await areaDirectory(area)) || path.join(TREES_ROOT, area);` tmux at `2342`. `workingDirectory` is the step's `--path` (`resolveStepPaths`, absolute and existing, else the launch fails). Fallback when no repo and no path: the Area folder in the vault.
- Describe-work session: `server.mjs:2237-2238`, same rule as the brain.
- Programs/commands: `server.mjs:596-602` require `program.cwd` (the Area Repository/Worktree or the program's own `cwd`), error text "This area needs a Repository or Worktree resource first."

**Observed, machine state.** Only 6 vault notes carry a Repository/Worktree line (`grep -rl` over `~/.tangent/trees`): `neara/hackathon/live-edit/live-edit.md`, `neara/pgande/speedrun/speedrun.md`, `neara/pgande/standards/standards.md`, `otto/tangent/tangent.md` (and `otto/tangent/impl-code-first-study-partner.md`, a Document), `otto/dnd/dnd.md`. `neara/neara.md` and `neara/portland/portland.md` have an empty `## Resources` (they hold only a `tangent.environment.v1` launch block). Consequence: the `neara` and `neara/portland` brains run with cwd `~/.tangent/trees/neara` and `~/.tangent/trees/neara/portland`.

Live tmux evidence (`tmux list-sessions -F '#{session_name} | #{session_path} | #{@tangent_kind} | #{@tangent_area}'`, 2026-08-27): brain sessions for test Areas run in `.../trees/otto/<area>`; `neara/portland` goal steps run in `/Users/julianotto/Projects/delivery` and `/Users/julianotto/git-worktrees/delivery/otto-nesc23` (a `--path`, since portland binds no Repository); `otto/tangent` steps run in `/Users/julianotto/Projects/otto-tangent`; a trigger runs in `~/.tangent/trees/neara/pgande/speedrun`.

Evidence that Claude Code has already run with cwd inside the vault: `.claude/` directories exist at `~/.tangent/trees/.claude/settings.local.json` (permission allow-list for two `curl ... /api/goals/...` commands), `~/.tangent/trees/neara/.claude/`, `neara/portland/.claude/`, `neara/hackathon/.claude/`, `neara/hackathon/embedded-js/.claude/` (empty). `~/.claude-otto/.claude.json` has exactly one `projects` entry under the vault: `/Users/julianotto/.tangent/trees` (Claude Code keys projects by git root).

## 2. How each harness discovers skills and instruction files

**Observed from vendor docs fetched 2026-08-27** (`https://code.claude.com/docs/en/skills`, `.../memory`):
- Claude Code skills: personal `~/.claude/skills/<name>/SKILL.md` (under `CLAUDE_CONFIG_DIR` this is `~/.claude-otto/skills`), project `.claude/skills/<name>/SKILL.md`. "Project skills load from `.claude/skills/` in the directory where you start Claude Code and in every parent directory up to the repository root." Nested `.claude/skills/` below cwd load lazily, "the first time Claude reads or edits a file inside that subdirectory". `--add-dir` / `/add-dir` load `.claude/skills/` and `.claude/commands/` from each added directory; `permissions.additionalDirectories` does not. A `<skill-name>` entry "can be a symlink to a directory elsewhere on disk". Name clash: "personal overrides project"; nested clash gets `apps/web:deploy` style names. Custom commands merged into skills.
- Claude Code CLAUDE.md: "loads `CLAUDE.md` and `CLAUDE.local.md` from your current working directory and every directory above it", concatenated root-down; subdirectory files load on demand; `~/.claude/CLAUDE.md` (config-dir) is user scope; `@path` imports; `--add-dir` CLAUDE.md only with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`. "Claude Code reads `CLAUDE.md`, not `AGENTS.md`"; docs recommend `@AGENTS.md` import or `ln -s AGENTS.md CLAUDE.md`. `.claude/rules/*.md` also loads, supports symlinks.
- Codex (`https://learn.chatgpt.com/docs/build-skills`, `.../agent-configuration/agents-md`): "Codex scans `.agents/skills` in every directory from your current working directory up to the repository root", plus `$HOME/.agents/skills`, `/etc/codex/skills`. AGENTS.md: `~/.codex/AGENTS.md` (or `AGENTS.override.md`), then "Starting at the project root (typically the Git root), Codex walks down to your current working directory", cap `project_doc_max_bytes` 32 KiB. No mention of `.codex/skills` or `.claude/skills`.
- pi (`packages/coding-agent/README.md` in badlogic/pi-mono, line 368): skills "in `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, or `.agents/skills/` (from `cwd` up through parent directories)". Context files (line 323): `~/.pi/agent/AGENTS.md`, parent directories walking up from cwd, current directory; `AGENTS.override.md` wins per directory. Line 298: pi asks before trusting a project folder that contains project `.agents/skills` with no saved decision in `~/.pi/agent/trust.json`. `--no-skills`, `--no-context-files`, `--system-prompt` still appends context files and skills.
- agy, opencode-gw, claude-gw: not inspected (see Unknowns). The Area note `otto/tangent/tangent.md` Ideas section records: "A context file lane (AGENTS.md + CLAUDE.md) is the one mechanism all four share" (claude, pi, codex, agy).

**Observed on this machine** (`ls -la`):
- `~/.agents/AGENTS.md` (the Tangent command guide loaded into every harness) and `~/.agents/skills/{create-skill,design,explain-code,impl,present,simple-english}`.
- `~/.claude/skills/`: per-skill symlinks `create-skill, design, explain-code, impl, present, simple-english -> ~/.agents/skills/<name>` plus real dirs `outcome, recall, remember, tangent-eval, write-for-reader`.
- `~/.claude-otto/skills -> /Users/julianotto/.claude/skills` (symlink, 12 Aug). `~/.claude-otto/CLAUDE.md` is two lines: `## Tangent commands` and `@~/.agents/AGENTS.md`.
- `~/.pi/agent/skills -> /Users/julianotto/.claude/skills`; `~/.pi/agent/AGENTS.md -> ~/.agents/AGENTS.md`; `~/.codex/AGENTS.md -> ~/.agents/AGENTS.md`.
- `~/.pi/setup-project.sh`: per checkout writes gitignored `.pi/settings.json` with `"skills": ["../.claude/skills"]` when `.claude/skills` exists (bridge pi to Claude project skills; `.pi/` is in `~/.config/git/ignore`).
- Harness aliases (`~/.zshrc:52-53,65,88`): `claude-otto="CLAUDE_CONFIG_DIR=~/.claude-otto claude --verbose --dangerously-skip-permissions"`, `claude-work="CLAUDE_CONFIG_DIR=~/.claude claude --verbose"`, `pi-code=<node22> pi`, `agyd='agy --dangerously-skip-permissions'`; `~/.local/bin/codex-gw` is `exec harness run codex "$@"` (neara-harness wrapper). Registry: `~/.tangent/trees/harnesses.md` (`tangent.harnesses.v1`) lists harnesses `claude, claude-otto, codex, codex-gw, claude-gw, opencode, pi-code, agy, agyd`.
- `~/.codex/config.toml` trusts `/Users/julianotto/.tangent/trees` and `/Users/julianotto/.agents` (`trust_level = "trusted"`).
- No directory-level `.claude -> .agents` symlink exists in the home, in this repo, or in the vault. The vault git tracks no symlinks (`git ls-files -s | awk '$1=="120000"'` is empty). No `AGENTS.md`, `CLAUDE.md`, or `SKILL.md` exists anywhere under `~/.tangent/trees` (`find`).

## 3. What the vault allows inside an Area folder

**Observed.** `~/.tangent/trees/README.md`: directories are nodes/Areas; each has `.gitkeep`; one note named after the directory; every other `.md` beside it is a Document; no rule mentions skills folders or dotfiles other than: "A noun node may define personal programs in an ignored `.processes.json`" (Named programs section) and, line 28, "Before you create or revise one, read `~/.agents/skills/simple-english/SKILL.md`", line 86 "All three are global skills in `~/.claude/skills/`". Line 92: "No other tooling for the vault: no CLI, no schemas, no databases" (stale relative to ADR-0020, which added the vault CLI).
- `~/.tangent/trees/.gitignore`: `.obsidian/`, `**/shared/`, `**/.processes.json`. Global `~/.config/git/ignore`: `.pi/`, `**/.claude/settings.local.json`. `git status --ignored` shows `!! .claude/` at the vault root. A `<area>/.claude` symlink or `<area>/.agents/` directory would be tracked unless ignored.
- Non-Markdown files are already tracked in the vault (six `.png` screenshots under `otto/dnd/` and `otto/tangent/`).
- `tangent vault commit <paths...>` (`packages/agent-shell/src/cli/commands/vault.ts:25-49, 62-68`) accepts any relative path inside the vault (`validateVaultPath` rejects absolute or `..` only), stages exactly those paths, and derives the `Tangent-Node` trailer from `dirname(paths[0])` (`areaFromPath`), so a path like `otto/tangent/.agents/skills/x/SKILL.md` commits but would stamp trailer `otto/tangent/.agents/skills/x` unless `--area` is passed.
- No governance lint over vault content exists in this repo (governance lints target repo architecture; `rg -i skill docs/architecture` finds nothing).

**Observed, Tangent's own walkers.** Every directory walk skips dot-entries and the reserved set `TREE_SKIP = {".git", ".obsidian", "shared", "node_modules"}`: `server.mjs:520,536` (`readTree`, the Area tree), `server.mjs:1040` (`vaultFingerprint`, index cache), `server.mjs:1303` (subtree Goal walk), `programs.mjs:69`, `area-operations.mjs:45`; `cleanAreaPath` rejects any dot-leading segment (`area-operations.mjs:17-25`, "Choose a valid area."). Therefore `<area>/.agents/` and `<area>/.claude` are invisible to Tangent (not Areas, not Documents). Conversely any non-dot subdirectory is an Area: `otto/tangent/area-map/` (a `.gitkeep` and `area-map.md`) shows in `GET /api/tree` as Area `otto/tangent/area-map`. `readAreaDocuments` (`server.mjs:658-675`) is non-recursive: every `.md` directly beside the note that is not `goal-`/`outcome-` prefixed is a Document with `kind: "document"`.

## 4. What the prompts carry today

**Brain prompt** (`brainPrompt`, `server.mjs:4502-4597`; sections composed by `boundedBrainPrompt` and `composeBrainPrompt` in `area-brain-domain.mjs:75-163`):
- `repository = areaDirectory(area)`; `instructions = inheritedInstructionFiles(repository, repository)` (`area-brain-domain.mjs:50-72`): reads `AGENTS.md` and `CLAUDE.md` in each folder from the repository root to the working folder (here root only) and returns `{file, hash, bytes}`. Rendered in section `## Area and repository context` (`server.mjs:4552-4556`) as `Area source: <note abs path>` per Area note (leaf to root, `areaNoteFiles` `server.mjs:1598-1608`), `Repository: <path>` or `Repository: none bound` (`4554`), `Instruction source: <file> sha256:<hash>` (`4555`). It is a reference with a hash, not inlined text. When no repository is bound, no instruction files are referenced at all (the vault has none anyway).
- `## Area memory`: `projectAreaMemory` (`area-brain-domain.mjs:38-41, 176-204`) projects only sections `Purpose`, `Current`, `Knowledge` of the exact Area note (1000/1000/1600 chars) and `Purpose`, `Knowledge` of each ancestor note (400/600). `## Resources`, `## Ideas`, and any other section are not projected.
- `## Selected Documents`: `selectCurrentDocuments` picks Documents wikilinked from open Goals, open Requests, or the founding instruction (`server.mjs:4531-4551`), each as `- <title>: <abs path> sha256:<hash>. Reason: ...`. Nothing is selected by recency or by folder.
- `## Retrieval order` (`4585`): "Search <area> and child Areas first. Then read parent Area sources and inherited repository instructions. Search wider Goals or linked systems only after those sources."
- Budget: `BRAIN_STRUCTURAL_LIMIT = 6_900` chars; required sections at `4592` are `Identity, Boundary, Execution contract, Wake, Work frontier, Questions, Unread messages, Asking Julian, Retrieval order`; optional sections (including Area and repository context, Area memory, Selected Documents) are dropped under pressure and listed in `## Omissions`.
- No skills section exists. `brain-command-reference.mjs` (a generated `tangent --help` reference) has no non-test caller (`rg -l "brain-command-reference"` returns only its test), so the brain prompt carries no command reference either; the brain learns commands from `~/.agents/AGENTS.md` via the harness context-file lane.

**Worker prompt** (`goalPrompt`, `server.mjs:1687-1745`; `pipelineStepPrompt`, `1750-1790`):
- `## Sources`: `- Goal: <abs>`, `- Area note N: <abs>` nearest to farthest, `- Document: <abs>` for every Document wikilinked from the Goal file (`goalContextDocuments` `1632-1660`, cap 64 links, 512 KB each). `tangent goal create --source <vault-file>` writes those links as a `## Sources` list in the Goal (`server.mjs:1231`); `sourceDocuments` (`1246-1260`) accepts at most 8 and only indexed Documents with `kind === "document"` (via `readVaultDocument`), so any `<area>/<name>.md` beside a note qualifies.
- The only skill reference in any generated prompt is hardcoded: `server.mjs:1731` "before writing design prose, read `~/.agents/skills/simple-english/SKILL.md` (pragmatic mode, with its self-check)" and `1739` the same path in the design-document paragraph. No `Instruction source` lines, no `AGENTS.md`/`CLAUDE.md` references for workers.
- `## Your step` (`1780`) carries the brain's step instruction verbatim; `## Brain` names the controlling brain; `## When you finish` demands `tangent handover --report '<json>' "<facts>"`.

**How brains tell workers to use a skill today.** By name inside the free-text step instruction, trusting home-level discovery. Queue records (`~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `area-goal-queue.v2`): 25 files contain "skill"; examples: "Run $design on this Goal (in codex the command is $design, not /design)", "/impl the design at neara/onboarding/design-onboarding-walkthrough-app.md", "use the /simple-english skill to rewrite ...", "using the updated /design skill's write-for-the-audience phase". `~/.tangent/trees/otto/tangent/plan-tangent.md:1041,1048,1416` plan steps as "uses the `design` skill ... implements with the `impl` skill ... `present` and `simple-english` skills". No instruction references a skill by path.

## 5. Area-level instruction files and precedents

**Observed.** None exist in the vault (section 2). The only Tangent-owned instruction files are repo-side: `packages/agent-shell/app/workspace/AGENTS.md` (operating rules for the chat workspace; `WORKSPACE` at `server.mjs:146` is only created and reported, not used as a spawn cwd in the paths above) and `packages/agent-shell/AGENTS.md`.
- Per-Area, file-based, Tangent-typed instructions already exist in one lane: triggers. `.processes.json` `triggers.<name>` requires `every`, `probe`, `instructions` (a string, per ADR-0030 an instructions file) and optional `cwd` (`programs.mjs:104-116`; ADR-0030 `docs/decisions/ADR-0030-area-triggers.md`). Programs inherit into descendant Areas ("nearest definition of a name wins", README Named programs).
- Design documents live per Area as Documents by decision (ADR-0023 bullet 6; `otto/tangent/impl-agent-pipelines.md` D6): the `/design` and `/impl` skills lost their fixed repo location; the Goal prompt names the Area folder. The Area note `otto/tangent/tangent.md` Knowledge records the drift incident that motivated `~/.claude-otto/skills -> ~/.claude/skills` ("a skill written only to `~/.claude/skills` is invisible to them").
- ADR-0033 (`docs/decisions/ADR-0033-area-brain-operating-model.md`): "The vault owns Area facts, Journals, Goals, and Documents. A bound repository owns code-agent instructions and architecture records. Agent Shell derives both inheritance stacks from their paths. Prompts contain bounded source references and hashes."
- ADR-0035: a worker with no `--launch` runs on the calling brain's own harness (`materializeStepLaunches`), so a brain on `claude-otto` normally spawns `claude-otto` workers; Areas may still mix harnesses per step.
- Pipeline CLI (`packages/agent-shell/src/cli/commands/goal.ts:105-131,166-191,217-240`): `tangent goal start <slug> [--step "<instruction>" --launch <harness[/model[/effort]]> --path <dir> --continue-from <n|-> --kind review]...` posts to `POST /api/goals/start`; `tangent goal append <slug> --step ...` posts to `POST /api/pipelines/append`. ADR-0023: "No saved pipelines."

## 6. Julian's words checked against the code
- "brains open in the tangent repository": false in general. A brain opens in the Area's bound Repository/Worktree when declared (otto/tangent -> `~/Projects/otto-tangent`; otto/dnd, three neara sub-Areas -> their repos), otherwise in the vault Area folder (`server.mjs:4804`). Vault-level skills are therefore natively visible only to brains of Areas that bind no repository.
- "workers should never be spawned in the tangent repository, in the work repository": today a worker starts in `--path`, else the Area repository, else the vault Area folder (`server.mjs:2339`). The fallback puts a worker inside the vault, which is neither.
- "Brains have access to the skill and can forward or reference it": today a brain can only name a global skill; no prompt lists which skills exist.

## Gap

Intent: per-Area, Markdown-encoded skills (how-to knowledge, repeatable pieces of work) living in the vault; every brain aware of the Area's skills (including inherited ones from parent Areas); a brain able to hand a worker an exact skill; skill chains expressed as pipelines; no new first-class concept.

Today:
1. Skills exist only at home level (`~/.agents/skills`, `~/.claude/skills` and symlinks). There is no per-Area skill anywhere in the vault and no convention or rule for one (README, .gitignore, walkers).
2. Brain awareness: the brain prompt has no skills section. Its only instruction-file lane is `inheritedInstructionFiles(repository)` which reads `AGENTS.md`/`CLAUDE.md` in the bound repository root (`area-brain-domain.mjs:64`) and never the vault. Harness-native discovery would work for a vault-cwd brain (Areas without a Repository line) but not for the five Areas that bind a repository, whose brains start in the repo (`server.mjs:4804`), which is where Julian's own brains (otto/tangent) live.
3. Worker hand-off: a worker prompt names Documents by absolute path (`## Sources`) and one hardcoded skill path (`server.mjs:1731,1739`). Brains name skills in free text by slash name (queue records), which resolves only because every harness home is symlinked to the same `~/.claude/skills`. A worker in a foreign repo (`/Users/julianotto/Projects/delivery`, `~/git-worktrees/...`, `~/Projects/polez`) sees that repo's project skills and the home skills, never anything under `~/.tangent/trees`.
4. Inheritance: Area-note memory inherits root to leaf (`projectAreaMemory`), Programs inherit to descendants (README), harness parent-walks stop at the git root (vault root) for Claude/Codex/pi; but there is no skill inheritance at all because there are no Area skills.
5. Skill chain as pipeline: pipelines are ad hoc (`--step` text typed by the brain; "No saved pipelines", ADR-0023). Nothing reads a Markdown file and turns it into `--step` arguments; the only file-driven agent instruction lane is the trigger `instructions` file.
6. Vault hygiene: dot-directories are invisible to Tangent (safe from becoming Areas) but also invisible to the Document index, reader, comments, and wikilinks; a non-dot `skills/` folder would become a child Area.

## Candidates

## Candidate A: Julian's harness-native layout (`<area>/.agents/skills/<name>/SKILL.md`, `<area>/.claude -> .agents`)

Mechanism: each Area folder may hold `.agents/skills/<name>/SKILL.md` (Codex and pi discover `.agents/skills` from cwd up to the git root; pi also `.claude/skills` via nothing, so the symlink is for Claude Code which reads `.claude/skills` from cwd up to the repository root). `<area>/.claude` is a relative symlink to `.agents`, committed to vault git (mode 120000). Brains must then start in the vault: change `spawnBrainSession` (`server.mjs:4804`) to `path.join(TREES_ROOT, record.area)` always, or keep the repo cwd and add `--add-dir ~/.tangent/trees/<area>` for Claude harnesses only (no Codex/pi equivalent found). Worker hand-off: the brain's step instruction must carry the absolute path (`~/.tangent/trees/<area>/.agents/skills/<name>/SKILL.md`) because the worker's cwd is a foreign repo. The brain prompt gains a bounded `## Skills` list (name, path, one-line description from SKILL.md frontmatter) so the brain knows what exists without the harness having to list it, or the harness's own `/skills` listing is trusted (Claude Code lists project skills; Codex/pi expose `/skill:name` and `$name`).

Touches: `server.mjs:4804` (brain cwd), vault README (new rule for `.agents/`), vault `.gitignore` (nothing to ignore; `.claude/settings.local.json` already globally ignored), `tangent vault commit` trailer derivation (`vault.ts:71` `areaFromPath` yields `<area>/.agents/skills/<name>`; needs `--area` or a dot-aware parent walk), optional `## Skills` section in `brainPrompt`.

Trade-offs: zero new concept for the harness, native `/design`-style invocation in a vault-cwd brain, live-reload in Claude Code. But: brains of repo-bound Areas lose repo-native discovery (project `.claude/skills`, `CLAUDE.md` of the repo, Codex `AGENTS.md` walk, and repo trust) if moved to the vault, and `inheritedInstructionFiles` was just added (ADR-0033) precisely to reference repo instructions; Julian also asked that brains never touch product repos, so a vault cwd is arguably right for a brain. Skills under a dot-dir are not Documents: invisible in the reader, not commentable, not wikilinkable, not `--source`-able. Name clashes with home skills resolve to the personal copy in Claude Code. pi prompts for trust on first vault start unless `~/.pi/agent/trust.json` covers the vault. Symlinks in the vault are new; Obsidian behaviour unknown. Two copies of the same skill tree name (`.agents` and `.claude`) confuse `find`/grep and any future vault lint.

Migration: create `.agents/skills` per Area on demand; move nothing from `~/.agents/skills` (global skills stay global); one commit per Area with `--area`. Flip brain cwd behind an env flag (`TANGENT_BRAIN_CWD=vault|repo`) for one release; verify with `AGENT_SHELL_TEST_NO_LAUNCH=1` HTTP tests that `session_path` equals the Area folder.

## Candidate B: Tangent-injected skills (harness-agnostic, no symlinks)

Mechanism: skills are ordinary vault Documents with a prefix, `<area>/skill-<slug>.md` (matching the existing `design-`, `plan-`, `impl-` conventions), so they are indexed by `readAreaDocuments` (`server.mjs:658`), readable in the Document reader, commentable, wikilinkable, and valid `--source` targets. The prompt builders list them: `brainPrompt` gets an optional bounded section `## Skills` built from `areaLineage(area)` root to leaf (`area-brain-domain.mjs:42-47`), each line `- <title>: <abs path> sha256:<hash> (<Area>)`, clipped with `clipSummary` and subject to `boundedBrainPrompt`; `goalPrompt` gets the same list for the worker's Area lineage, or only the skills the brain named. A brain hands a skill to a worker by `tangent goal start <slug> --step "Follow the skill at <abs path> ..."` or by `tangent goal create --source otto/x/skill-y.md` so the Document lands in `## Sources` automatically. Cwd stays as today.

Touches: `server.mjs` prompt builders (`4502`, `1687`), `area-brain-domain.mjs` (a `selectAreaSkills(lineage, documents)` beside `selectCurrentDocuments`), README (one paragraph: `skill-<slug>.md` is a Document that explains a repeatable piece of work), tests `brain-prompt.test.mjs` and a new worker prompt test. No harness config, no symlinks, works for agy/opencode/claude-gw too.

Trade-offs: a skill is not invocable as `/name` or `$name`; the agent must Read the file (the same mechanism the prompt already uses for `simple-english`, `server.mjs:1731`). Costs prompt budget in a 6,900-char structural cap: with many skills the section is clipped or omitted, so the list needs a cap (say 12) plus an omission line "run `tangent document list <area> --kind skill`" (no such command exists today; `tangent document` has `comments|resolve` only). Frontmatter (`type: skill`) would need the vault README's allowed-properties list extended (README allows `type: project|work|routine` on notes and `type: outcome` on outcomes; Documents carry `type: document`).

Migration: none for existing data; new Documents only.

## Candidate C: both (A for the harness, B for Tangent's prompts and hand-off)

Mechanism: the canonical file is `<area>/skill-<slug>.md` (a Document) and a generator or convention mirrors it as `<area>/.agents/skills/<slug>/SKILL.md` (symlink `SKILL.md -> ../../../skill-<slug>.md`), with `.claude -> .agents`. Harness-native invocation works in vault-cwd sessions; Tangent's prompts list skills by path for every other session.

Trade-offs: two representations to keep consistent (the exact drift that bit `~/.claude-otto/skills` in August); mitigated by one direction of truth (Document) and a `tangent area skills sync` or a reconcile pass that rebuilds the dot tree from `skill-*.md`. Highest coverage, most moving parts.

## Candidate D: skill chains as pipelines (applies to A, B, or C)

Mechanism: a skill Document may carry a fenced `tangent.pipeline.v1` block (like `tangent.environment.v1` in Area notes and `tangent.harnesses.v1` in `harnesses.md`): an ordered list of `{instruction, launch?, path?, kind?}`. `tangent goal start <slug> --skill <vault-file>` (or `--recipe`) expands the block into the same `steps` payload `POST /api/goals/start` already takes (`goal.ts:116-121`), with `--launch` defaults filled by ADR-0035's lending. Each step instruction may reference other skill files by path, which is the chain. No saved-pipeline registry is introduced (ADR-0023 stays true: the pipeline is still composed at start, from a Document the brain and Julian can read and comment on).

Touches: `goal.ts` (`pipelineSteps` gains one source of steps), server-side validation of the block, a reader affordance to show the steps. Interacts with candidate B's prefix convention.

Trade-offs: the block is a small schema in Markdown, which the README today says the vault should not have ("no schemas"), though `tangent.environment.v1` and `tangent.harnesses.v1` already set the precedent. Recommend A or B first; D after one real chain (Julian's "commits ready for review" case) has been typed by hand twice.

## Counterexamples

1. **Brain cwd is the repo for repo-bound Areas** (`server.mjs:4804`; `otto/tangent/tangent.md` `- Repository: ~/Projects/otto-tangent`). A naive "put `.agents/skills` in the Area folder and the brain will see it" fails for otto/tangent, otto/dnd, neara/hackathon/live-edit, neara/pgande/speedrun, neara/pgande/standards. Claude Code's parent walk stops at the repository root of the cwd, which is the product repo, not the vault.

2. **Workers run in foreign repositories** (tmux `session_path` `/Users/julianotto/Projects/delivery`, `~/git-worktrees/delivery/otto-go95-pgande`, `~/Projects/polez`) and their `## Sources` are absolute vault paths (`goalPrompt`). Harness discovery cannot reach the vault from there; only an absolute path in the instruction or in `## Sources` works. `--add-dir` exists for Claude only and would have to be injected into the launch command, which ADR-0035 and `harnesses.md` say Tangent never rewrites ("Tangent never rewrites these strings").

3. **A non-dot `skills/` folder becomes a child Area**: `readTree` (`server.mjs:527-541`) treats every non-dot, non-reserved directory as an Area; `otto/tangent/area-map/` is live proof in `GET /api/tree`. Candidate B must keep skills as files beside the note (`skill-<slug>.md`), not in a `skills/` directory, or add `skills` to `TREE_SKIP` at every walker (`server.mjs:520,1040,1303`, `programs.mjs:10`, `area-operations.mjs` RESERVED).

4. **Dot-directories are invisible to the Document index**: `readAreaDocuments` filters `*.md` in the Area directory only; `.agents/skills/x/SKILL.md` never becomes a Document, so it cannot be a `--source` (`sourceDocuments` requires `kind === "document"`), cannot be commented (`tangent document comments`), and will not show in the reader or the Area map.

5. **Prompt budget**: `BRAIN_STRUCTURAL_LIMIT = 6_900` and the required-section list at `server.mjs:4592` mean a skills list is optional and can be silently dropped into `## Omissions`; `projectAreaMemory` already clips ancestor `Knowledge` to 600 chars, so "put skills in the Area note Knowledge" is not a reliable channel either.

6. **Name shadowing**: Claude Code "personal overrides project" for same-named skills; a vault skill named `design` under `<area>/.claude/skills/design` loses to `~/.claude/skills/design`. Nested clashes get directory-qualified names (`neara/portland:design`), which a brain will not guess. Codex/pi precedence not documented in what was fetched.

7. **Trust prompts on first start**: pi "asks before trusting a project folder that contains ... project `.agents/skills`" (README line 298); Codex already trusts `/Users/julianotto/.tangent/trees` (`config.toml`); Claude Code trust for plain project skills not established. A brain start that blocks on a trust dialog looks like a stalled brain (prompt delivery is typed after the harness reaches its prompt: `armSession` then `typeInto`, `server.mjs:4870-4874`).

8. **Vault commit trailer**: `areaFromPath` (`vault.ts:69-72`) derives `Tangent-Node` from the file's directory; committing `otto/tangent/.agents/skills/review/SKILL.md` without `--area` stamps a non-Area path; `cleanAreaPath` would reject that path if anything later validates the trailer.

9. **Symlinks in the vault are new**: `git ls-files -s` shows no mode-120000 entries; `~/.claude/.gitignore` and the vault `.gitignore` have no rule for `.agents/` or `.claude/`; Obsidian (which "can open" the vault) behaviour with a symlinked directory is not verified. Worktrees are not used for the vault, so the pi "gitignored files do not propagate to worktrees" caveat does not apply, but `~/.pi/setup-project.sh` writes `.pi/settings.json` pointing at `../.claude/skills` only at a git toplevel, so a vault-cwd pi brain in `trees/neara/portland` would not get that bridge and relies on its native `.agents/skills` walk instead.

10. **`inheritedInstructionFiles` throws when the working folder is outside the repository** (`area-brain-domain.mjs:55`): reusing it for vault lineage requires passing `TREES_ROOT` as the repository, and it only looks for `AGENTS.md`/`CLAUDE.md`, not `SKILL.md`.

11. **Fallback cwd for workers is the vault Area folder** (`server.mjs:2339`) when an Area binds no repository and the step names no `--path`. A worker started there would natively see Area skills but would also be writing inside the vault, contrary to memo 2 ("workers should never be spawned in the tangent repository"); any design should decide whether that fallback stays.

12. **The brain prompt has no command reference** (`brain-command-reference.mjs` unused), so a new `tangent ... --skill` flag is learned only through `~/.agents/AGENTS.md`; that file must gain a bullet, as ADR-0023 and ADR-0024 did for earlier commands.

## Unknowns

- **agy (Antigravity), opencode-gw, claude-gw skill and context-file discovery**: not inspected. The Area note idea line says agy reads `GEMINI.md/AGENTS.md/.agents/rules`. Establish by reading each tool's docs or by starting one in a folder with a `.agents/skills/probe/SKILL.md` and asking it to list skills.
- **Claude Code behaviour when cwd is a subdirectory of a git repo whose root is the vault**: docs say parent walk "up to the repository root"; verify with a throwaway skill in `~/.tangent/trees/.claude/skills/` and `/skills` from a session started in `trees/neara/portland` (and whether the vault root `.claude/` counts as project scope for trust).
- **Whether Claude Code plain project skills need the workspace trust dialog** (docs mention trust only for skills-directory plugins). Test the same way.
- **Codex sandbox reading the vault from a foreign repo cwd**: `otto/tangent/tangent.md` idea line 84 records write and network denials; reads of `~/.tangent/trees/...` from a sandboxed Codex worker were not verified. Test with a step that `cat`s a vault file.
- **Where the trigger runtime reads its `instructions` file**: `rg` over `packages/*/src/cli/commands/trigger*.ts` found nothing; the implementation location (ADR-0030 says "root-owned `tangent trigger` runtime") was not located. Find with `tangent search "trigger sweep"` or `rg -l "instructions" packages/*/src`.
- **Obsidian with symlinked directories and duplicate skill trees**: not tested.
- **Whether `terminal-transport.mjs:48` (`cwd: workspace`) affects any brain or worker**: it is the browser terminal transport; not traced to a spawn path.
- **Installed Claude Code version** (nested-skill and symlink features carry version gates in the docs): run `claude --version` under both config dirs.
- **pi trust store** `~/.pi/agent/trust.json` contents (whether the vault is already trusted): not read.
- **How many vault Areas will carry skills and how long they are**: needed to size the brain prompt section against the 6,900-char structural cap; count from Julian's "commits ready for review" case once written.

## Sources

- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/server.mjs (lines 146, 237-247, 466-471, 508-541, 596-602, 658-675, 1030-1050, 1231, 1246-1260, 1296-1310, 1598-1660, 1687-1790, 2219-2268, 2269-2400, 2627, 4502-4597, 4799-4880)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-launch.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-brain-domain.mjs (lines 9-41, 42-163, 176-204, 207)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-operations.mjs (lines 17-50)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/programs.mjs (lines 1-125, 186-199)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/vault-documents.mjs (lines 23-35)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-command-reference.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/agent-context.mjs (skeleton)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/workspace/AGENTS.md
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-prompt.test.mjs (lines 1-15, 120, 410)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/goal.ts (lines 15, 105-191, 217-266, 476)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/vault.ts (lines 7-49, 55-93)
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0024-area-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0030-area-triggers.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0031-agent-shell-capability-ownership.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0033-area-brain-operating-model.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-operating-vision/user-intent.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-work-contract/design-record.md (grep: lines 355, 390, 970)
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-navigation-model/design-record.md (grep only)
- /Users/julianotto/Projects/otto-tangent/handover.md (lines 1-40)
- /Users/julianotto/.tangent/trees/README.md
- /Users/julianotto/.tangent/trees/.gitignore
- /Users/julianotto/.tangent/trees/harnesses.md
- /Users/julianotto/.tangent/trees/otto/tangent/tangent.md
- /Users/julianotto/.tangent/trees/neara/neara.md (Resources section)
- /Users/julianotto/.tangent/trees/neara/portland/portland.md (Resources section)
- /Users/julianotto/.tangent/trees/otto/tangent/plan-tangent.md (grep: lines 93, 1041, 1048, 1416)
- /Users/julianotto/.tangent/trees/otto/tangent/impl-agent-pipelines.md (grep: lines 32, 289, 391-393)
- /Users/julianotto/.tangent/trees/otto/tangent/design-living-documents.md (grep)
- /Users/julianotto/.tangent/trees/otto/tangent/outcome-outcome-skill.md (grep: lines 12-18)
- /Users/julianotto/.tangent/trees/.claude/settings.local.json and neara/.claude, neara/portland/.claude, neara/hackathon/.claude (ls)
- /Users/julianotto/.tangent/agent-shell/brains/neara/brain.json (schema and area fields)
- /Users/julianotto/.tangent/agent-shell/pipelines/*/*/*.json (schema area-goal-queue.v2; instruction grep)
- /Users/julianotto/.agents/AGENTS.md and /Users/julianotto/.agents/skills (ls)
- /Users/julianotto/.claude/skills, /Users/julianotto/.claude-otto/skills, /Users/julianotto/.claude-otto/CLAUDE.md, /Users/julianotto/.claude-otto/settings.json (ls, cat)
- /Users/julianotto/.claude/.gitignore
- /Users/julianotto/.codex/AGENTS.md (symlink), /Users/julianotto/.codex/config.toml
- /Users/julianotto/.pi/agent (ls), /Users/julianotto/.pi/agent/settings.json, /Users/julianotto/.pi/setup-project.sh
- /Users/julianotto/.zshrc (lines 52-53, 65, 88), /Users/julianotto/.local/bin/codex-gw
- /Users/julianotto/.config/git/ignore
- /Users/julianotto/.claude-otto/.claude.json (projects keys under the vault)
- tmux list-sessions -F '#{session_name} | #{session_path} | #{@tangent_kind} | #{@tangent_area}' (2026-08-27)
- git -C ~/.tangent/trees ls-files -s; git status --ignored; git check-ignore -v
- GET http://127.0.0.1:4321/api/tree (otto/tangent subtree)
- https://code.claude.com/docs/en/skills (fetched 2026-08-27)
- https://code.claude.com/docs/en/memory (fetched 2026-08-27)
- https://learn.chatgpt.com/docs/build-skills (fetched 2026-08-27)
- https://learn.chatgpt.com/docs/agent-configuration/agents-md (fetched 2026-08-27)
- https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/README.md (lines 298, 323-330, 354-368, 597-610)

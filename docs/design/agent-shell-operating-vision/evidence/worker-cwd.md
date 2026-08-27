# worker-cwd: where Tangent starts worker and brain sessions (tmux `-c <dir>`), how the Area note binds a repository, and what happens when it does not

## Observed

## 1. One resolver decides every spawn directory: `areaDirectory(area)`

All observed unless marked.

- `packages/agent-shell/app/server.mjs:443-458` `areaResource(area, label)` reads exactly one file, `<TREES_ROOT>/<area>/<basename(area)>.md`, and calls `noteResource(text, label)`. It reads only the exact Area's note. It does not walk parents.
- `server.mjs:460-471` `areaDirectory(area)`: `areaResource(area, "Repository|Worktree")`, expands leading `~`, returns the path only if `path.isAbsolute(dir) && existsSync(dir)`, else `null`. Doc comment: "Resolves the working directory for a tree area from its area note's `## Resources` section (a `Repository:` or `Worktree:` line)".
- `packages/agent-shell/app/area-agent-command.mjs:8-13` `noteResource(note, label)`: takes the `## Resources` section (split on `^## `) and matches `(?:Repository|Worktree)[^:\n]*:\s*\`?([^\`\n]+?)\`?\s*$` with flags `im`. A colon is mandatory; backticks around the value are tolerated; everything after the colon to end of line is the value.
- A second, independent parser exists for Programs: `packages/agent-shell/app/programs.mjs:44-59` `programDirectory(treesRoot, area)` with regex `^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$` and the same `~` + `existsSync` rule. Programs, on-demand commands and triggers use this one (`programs.mjs:130-156`, `entry.cwd || cwd`).

## 2. Worker spawn: `spawnGoalSession`

- `server.mjs:2262-2269` signature: `spawnGoalSession(area, slug, { ..., path: workingDirectory = "", ..., pipeline = null, continuation = null, ... })`. Doc: "The path option gives the new pane one exact directory instead of the Area repository; a pipeline step passes its own."
- `server.mjs:2336-2342`:
  ```js
  // The step's own directory wins when it named one; without it the Area
  // repository stays the default, so nothing changes for the steps that
  // omit it. resolveStepPaths already proved the directory exists.
  const dir = workingDirectory || (await areaDirectory(area)) || path.join(TREES_ROOT, area);
  ...
  const immutableTarget = await createOwnedTmuxSession(phaseName, ["-d", "-s", phaseName, "-c", dir]);
  ```
  Three-way fallback: explicit step path, then exact-Area binding, then **the vault Area folder `~/.tangent/trees/<area>`**. The third branch is silent: no warning, no record, no prompt line.
- Options set on the session (`server.mjs:2344-2356`): `@tangent_area`, `@tangent_goal`, `@tangent_kind goal`, `@tangent_phase`, `@tangent_launch_command`, `@tangent_pipeline`, `@tangent_step`, `@tangent_assignment`, `@tangent_attempt`. No cwd option is set; the server later reads `#{session_path}` as `cwd` in `loadSessions` (`server.mjs:284-301`) and exposes it in `GET /api/sessions` (`server.mjs:358-359`, route `packages/agent-shell/app/shell-state-routes.mjs:7`).
- Reattach path (`server.mjs:2311-2335`): an existing session is re-primed and its cwd is never touched.
- Solo start (`tangent goal start <slug>` without `--step`, or the desk's Start agent) posts `POST /api/goals/start` with `{ file, approved: true, launch: true, choice }` (`packages/agent-shell/src/cli/commands/goal.ts:119-122`) and reaches `spawnGoalSession` with no `path`, so it always takes the Area-binding-or-vault-folder branch.
- `server.mjs:2569-2580` `startGoal`: "Extra Goals must share the primary's Area: one session, one repository."

## 3. Per-step directory (`--path`) is the only explicit cwd today

- CLI: `goal.ts:15` registers `path` as repeatable; `goal.ts:105` help `tangent goal start <slug> [--step <instruction> --launch <harness[/model[/effort]]> --path <directory> --continue-from <n|->]...`; `goal.ts:166` same for `tangent goal append`.
- `goal.ts:224-242` pairs `--path` with `--step` by position. Refusals: `"--path belongs to a --step; add --step \"<instruction>\" or start the Goal without --path."` (`goal.ts:230`) and `"More --path values than --step values; ..."` (`goal.ts:234`).
- `goal.ts:250-260` `parseStepPath`: resolves `~` and relative paths **against the CLI's cwd** because "the Agent Shell server cannot see the caller's directory". Empty `--path=` means the Area repository.
- Server: `server.mjs:2650-2676` `resolveStepPaths(steps, firstIndex)`: requires absolute, existing directory; errors `step N: path X is not an absolute directory` and `step N: no directory X`; runs before any record is written. Callers: `startPipeline` (`server.mjs:2887`, `POST /api/goals/start` with `steps`) and `appendPipelineSteps` (`server.mjs:3431`, `POST /api/pipelines/append`).
- `startPipelineStep` (`server.mjs:2769`) passes `path: step.path` (`server.mjs:2833`); `continueWorkerSession` passes `path: assignment.path` (`server.mjs:3903`) so a context continuation keeps the step's directory (rationale doc records the earlier bug where it did not).
- Pipeline record: `assignments[].path` is a stored field (keys observed via jq on `~/.tangent/agent-shell/pipelines/**/*.json`); `path` is `null` when omitted (`launch-environment-http.test.mjs:199` "the record keeps an omitted path explicit"). Attempts carry `{ endedAt, id, instanceId, kind, report, result, session, startedAt }` and **no cwd**. `grep -l '"cwd"'` over all 285 records: 0.
- Browser: `packages/agent-shell/app/public/goal-launch-view.js:616` renders `Path (optional)` with placeholder `Repository path` (`data-launch-path`), posted as `path` (`goal-launch-view.js:278`).
- Tests: `packages/agent-shell/app/launch-environment-http.test.mjs:190-245` asserts `#{pane_current_path}` equals the Area repository when path omitted, equals the arbitrary directory when given, and 400 for a missing or relative directory; `pipeline-record.test.mjs:145,169` trims and stores `path`; `area-agent-command.test.mjs:11` shows a `Repository: ignored` line outside `## Resources` is ignored.

## 4. Brain spawn: `spawnBrainSession`

- `server.mjs:4799-4839`: `const directory = (await areaDirectory(record.area)) ?? path.join(TREES_ROOT, record.area);` (line 4804) then `createOwnedTmuxSession(name, ["-d", "-s", name, "-c", directory])` (line 4839). Options: `@tangent_kind brain`, `@tangent_phase orchestrate`, `@tangent_brain <area>`, `@tangent_generation <n>`.
- Callers: resume (`server.mjs:4998`), first start (`server.mjs:5015`), handover replacement (`server.mjs:5114`). Route: `POST /api/brains/start` (`packages/agent-shell/app/brain-routes.mjs:22`). The CLI has no `brain start`: `packages/agent-shell/src/cli/commands/brain.ts:13-19` dispatches only handover, advance, request, withdraw, status, stop.
- So a brain opens in the **same place a worker would**: the Area's bound repo, else the vault Area folder. "Brains open in the tangent repository" is literally true today only for the `otto/tangent` brain, because that Area binds `~/Projects/otto-tangent`.
- Brain record (`~/.tangent/agent-shell/brains/<area>/brain.json`) generation entries have keys `deliveryStatus, endedAt, generation, handover, instanceId, notices, remindedAt, resolvedLaunch, session, startedAt` (plus `target`): no directory.
- Brain prompt (`server.mjs:4501-4595`): `const repository = await areaDirectory(area)` (4508); `inheritedInstructionFiles(repository, repository)` (4509; defined `area-brain-domain.mjs:50-72`, collects `AGENTS.md`/`CLAUDE.md` from repo root down to the working folder); the "Area and repository context" section prints `Repository: <path>` or `Repository: none bound` (4554); "Retrieval order" says "Then read parent Area sources and inherited repository instructions" (4585). A brain in an unbound Area is told `Repository: none bound` and gets no instruction files.

## 5. Other spawn paths

- Describe work: `server.mjs:2219-2262` `spawnDescribeWorkSession`: `const directory = (await areaDirectory(area)) ?? path.join(TREES_ROOT, area);` (2237). Route at `server.mjs:6718`.
- Sidebar `+` plain shell: `server.mjs:505-518` `spawnSession` refuses with `{ status: 409, error: "no repo recorded, ask chat" }` when `areaDirectory` is null. This is the only worker-like spawn that refuses.
- Programs / on-demand commands: `server.mjs:596` `throw new Error("This area needs a Repository or Worktree resource first.")`; browser shows `Folder` / `Working folder` (`public/program-view.js:124,148`) and confirms "Run “<cmd>” in <cwd>." (`public/shell-coordinator.js:400`).
- Chat pane: `server.mjs:146` `const WORKSPACE = process.env.WORKSPACE ?? path.join(here, "workspace")` (folder `packages/agent-shell/app/workspace/` holds only `AGENTS.md` and `CLAUDE.md`); `prepareTerminalSession` (`server.mjs:429-441`) and `terminal-transport.mjs:39,48` start it with `-c workspace`.
- `tangent study`: `packages/agent-shell/src/cli/commands/study.ts:42` spawns with `stdio: "inherit"` and no `cwd`, so it inherits the caller's shell cwd (ADR-0026 conventions).
- Trigger workers (ADR-0030) use `programDirectory` via `programs.mjs`; the live speedrun trigger session sits in `/Users/julianotto/.tangent/trees/neara/pgande/speedrun` (tmux `#{pane_current_path}`), consistent with a vault-folder fallback. The trigger runtime code itself was not read (see Unknowns).

## 6. Worker prompts never say where the worker is

- `goalPrompt` (`server.mjs:1687-1745`) lists `- Goal:`, `- Area note N:`, `- Document:` sources, says "Read files wherever they are; write new design documents there" and "Design documents for this work belong in the Area folder `<TREES_ROOT>/<area>`". No working-directory or repository line.
- `pipelineStepPrompt` (`server.mjs:1750-1790`) adds step, handovers, typed report contract. No directory line.
- `describeWorkPrompt` (`server.mjs:1660-1685`) lists `- Area folder: <TREES_ROOT>/<area>` and says "look at the Area's repository" without naming a path.
- Only the brain prompt names the repository (`Repository: <path>` / `Repository: none bound`).

## 7. What Area notes actually declare (vault, read 2026-08-27)

29 Area notes under `~/.tangent/trees`. `## Resources` bindings:
- `otto/tangent/tangent.md:99` `- Repository: ~/Projects/otto-tangent` (the tangent Area's work repo IS the tangent repo).
- `otto/dnd/dnd.md` `- Repository: ~/Projects/otto-dnd` (present in vault git history since before 2026-08-10).
- `neara/pgande/standards/standards.md` `- Repository: ~/Projects/delivery`.
- `neara/hackathon/live-edit/live-edit.md` `- Worktree: /Users/julianotto/Projects/polez-live-edit`.
- `neara/pgande/speedrun/speedrun.md` `- Worktree: /Users/julianotto/git-worktrees/delivery/pgande-speedrun (tracks origin/pgande-staging; recreated by the agent if missing)`: the regex captures the whole tail including the parenthetical, `existsSync` fails, so this binding resolves to **null** even though `/Users/julianotto/git-worktrees/delivery/pgande-speedrun` exists (Observed: directory exists; resolution to null is inferred from the regex, not executed).
- `neara/pgande/pgande.md:41-42` `- Repository \`$POLEZ\` — dart` / `- Repository \`$DELIVERY\` — dim`: no colon, so no match; `$POLEZ` would not expand anyway.
- The other 23 notes (including `neara`, `neara/portland`, `neara/onboarding`, `neara/enums`, `neara/hackathon/embedded-js/*`, `otto/launcher`, `otto/dnd/{dialogue,players,testing}`, `otto/tangent/{area-map,desk,model}`, `otto`) have no `Repository`/`Worktree` line. `otto/otto.md:20-45` has an empty `## Resources` and a `tangent.environment.v1` block that declares only launch defaults (no repository field exists in that schema; `launch-environment.mjs` has no directory logic).
- `~/.tangent/trees/README.md:75` (Programs rule): "Otherwise, the process uses that node's Repository or Worktree." `README.md:86`: the `outcome` skill resolves the node "from the repository recorded in `## Resources`".

## 8. What actually ran (records, transcripts, live tmux)

- Pipelines: 285 records, 717 steps, 716 started (594 complete, 118 ended, 3 skipped, 1 stopped, 1 pending). Steps with explicit `path`: 58 (neara/portland 44 across `~/Projects/delivery` and two `~/git-worktrees/delivery/*`; neara 8 in `~/Projects/polez` and `.plz-review-worktree`; neara/onboarding 4 in `polez/.onboarding-worktree`; viz-input 2 in `~/Projects/polez`).
- Started steps with no `path`, by Area, resolved under today's code and today's notes: bound Areas: `otto/tangent` 310 (cwd `~/Projects/otto-tangent`), `otto/dnd` 57, `neara/pgande/standards` 59, `neara/hackathon/live-edit` 8. Unbound Areas (cwd = vault folder `~/.tangent/trees/<area>`): `neara` 97, `neara/enums` 18, `neara/essential/autodesign` 7, `neara/hackathon` 1, `embedded-js` 20, `outage-modelling` 7, `storm-response` 15, `neara/onboarding` 18, `neara/pgande` 1, `pgande/autodesign` 1, `viz-input` 7, `neara/portland` 2, `otto/dnd/dialogue` 4, `otto/dnd/players` 8, `otto/dnd/testing` 12, `otto/launcher` 5, `otto/test` 1: **224 steps, 31% of all started steps**. (Assumption: the notes had the same bindings when those steps ran; the dnd binding is older than the child steps, which ran 2026-08-19..23.)
- Transcript corroboration (Claude Code project dirs modified since 2026-08-17, `~/.claude/projects` + `~/.claude-otto/projects`): `-Users-julianotto--tangent-trees-neara` 46, `...-neara-hackathon-embedded-js` 27, `...-embedded-js-storm-response` 17, `...-otto-dnd-testing` 13, `...-otto-dnd-players` 8, `...-neara-enums` 8, `...-outage-modelling` 7 transcripts started with cwd inside the vault. Codex rollouts in `~/.codex/sessions/2026/08`: `~/Projects/otto-tangent` 678, `~/Projects/otto-dnd` 112, `~/.tangent/trees/otto/launcher` 72 (the launcher brain's 33 generations plus its workers, while the launcher code lives in `~/Projects/otto-launcher`, which has 2 rollouts), `~/.tangent/trees/neara/pgande/megabranch/viz-input` 4, `~/.tangent/trees/otto/dotfiles` 1.
- Side effects of running in the vault: `~/.tangent/trees/.claude/settings.local.json` (created 2026-08-27 00:41, permission allowlist for two `curl http://127.0.0.1:4321/api/goals/...` calls) and empty `.claude/` dirs in `neara`, `neara/portland`, `neara/hackathon`, `neara/hackathon/embedded-js`. No `.agents` dirs exist in the vault (find depth 4).
- Live tmux now (`tmux list-sessions` with `#{pane_current_path}`): tangent workers in `~/Projects/otto-tangent` (5), portland workers in `~/Projects/delivery` and the two delivery worktrees (5, via `--path`), viz-input worker in `~/Projects/polez` (via `--path`), speedrun trigger in `~/.tangent/trees/neara/pgande/speedrun`. No production brain is live; test-probe brains sit in temp vaults.
- The Usage SQLite index is stale (max `last_activity_at` 2026-08-16) and most Claude sessions there have `repo: {}`; transcripts were counted directly instead.

## 9. Prior decisions on this theme

- Vault `otto/tangent/design-goal-launch-environments.md:154,226`: "A pane can declare an optional `path` for its working directory. The default directory is the Area repository." and "A launch uses the Area's declared repository by default. One pipeline step can name a different directory with `tangent goal start --path` ... a step is the only place that chooses a directory today." Worktrees/branches deferred (line 32, 224).
- Vault `otto/tangent/rationale-allow-brains-to-spawn-worker-agents-in-any-arbit.md` (commits 5175a86, 25387bd, 2026-08-25): "The one expression `workingDirectory || (await areaDirectory(area)) || path.join(TREES_ROOT, area)` in `spawnGoalSession` keeps the old default exactly." Rejected: per-pane `path` in `tangent.environment.v1`; server-side relative resolution.
- ADR-0035 (`docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md`) is the closest structural precedent: a launch that names nothing takes the brain's own, is disclosed before the worker is created (`discloseAssignmentLaunch`, `launchSource` on the record), and a refusal happens before anything is written. Nothing equivalent exists for the directory.
- ADR-0033: "The vault owns Area facts, Journals, Goals, and Documents. A bound repository owns code-agent instructions and architecture records."
- ADR-0030: triggers declare "an optional working directory" and otherwise reuse "repository resources".
- `docs/design/agent-shell-operating-vision/user-intent.md:27-29,50-51` holds Julian's exact words for this theme.

## Gap

Julian's intent: worker cwd = the work repository, never the tangent repository; brain cwd = the tangent repository (so brains see Area skills and forward them).

Today:

1. **Worker cwd is a silent three-way fallback** (`server.mjs:2339`): step `--path`, else the exact Area's `## Resources` `Repository:`/`Worktree:` line, else the vault Area folder `~/.tangent/trees/<area>`. 224 of 716 started steps (31%) took the vault-folder branch. Nothing refused, warned, disclosed, or recorded it. The record has `path: null` and no resolved cwd; transcripts are the only evidence.

2. **Nested Areas do not inherit the parent's repository.** `areaDirectory` reads only `<area>/<basename>.md`. `otto/dnd` binds `~/Projects/otto-dnd`, yet `otto/dnd/testing` (12 steps, 13 transcripts) and `otto/dnd/players` (8 steps, 8 transcripts) ran in `~/.tangent/trees/otto/dnd/<child>`. Same for `otto/tangent/{area-map,desk,model}`. Area notes DO inherit for prompts (`areaNoteFiles`, `server.mjs:1598-1606`, nearest to farthest), so the asymmetry is a surprise.

3. **"Never in the tangent repository" is not the observed failure; "in the vault folder" is.** Only `otto/tangent` binds the tangent repo, and its work repo is the tangent repo, so 310 tangent workers there are correct. The launcher Area (`otto/launcher`) is the clearest case of the bug shape Julian means: its brain and workers ran in `~/.tangent/trees/otto/launcher` (72 codex rollouts) while the code is in `~/Projects/otto-launcher`, because the note never bound it.

4. **Brains do not open in the tangent repository.** `spawnBrainSession` (`server.mjs:4804`) uses the same resolver: bound repo or vault folder. The `neara/portland` brain (14 generations) and `neara` brain (189 generations) opened in vault folders with `Repository: none bound` in their prompt and no inherited `AGENTS.md`/`CLAUDE.md`. The `otto/dnd` brain opened in `~/Projects/otto-dnd`, which is a work repo, not the tangent repo.

5. **The binding format is prose with two parsers.** `noteResource` (`area-agent-command.mjs:8-13`) and `programDirectory` (`programs.mjs:44-59`) differ (backticks; multi-line tolerance), both silently return null on an annotated line (`speedrun`: `- Worktree: <path> (tracks ...)`) or a colon-less line (`pgande`: `- Repository \`$POLEZ\` — dart`). No lint, no UI, and no CLI shows an Area's resolved directory; the browser shows a directory only for Programs.

6. **Workers are never told where they are.** `goalPrompt`/`pipelineStepPrompt` carry no repository or cwd line; only the brain prompt does.

7. **Only two spawn paths refuse a missing binding** (sidebar `+`: `"no repo recorded, ask chat"`; Programs: `"This area needs a Repository or Worktree resource first."`). Goal starts, pipeline steps, Describe work, and brains all fall through.

8. **Skills coupling (theme area-skills).** A brain in the tangent repo would get `~/Projects/otto-tangent/.claude/skills/{mark-agent-mistake,setup-tangent-eval,verify-app}` and the tangent `CLAUDE.md` (which mandates `tangent search` and describes the tangent codebase). It would NOT see per-Area `.agents`/`.claude` folders inside `~/.tangent/trees/<area>`, because harness skill discovery is cwd-anchored (Assumption for Claude Code; Unknown for codex/pi). The Tangent command vocabulary already reaches every claude-otto session through `~/.claude-otto/CLAUDE.md` -> `@~/.agents/AGENTS.md`, independent of cwd.

## Candidates

## Candidate A: Strict worker invariant with inherited binding, loud refusal, recorded cwd (recommended for workers)

Mechanism:
- New `workRepository(area)` in `server.mjs` (or a small `area-repository.mjs` module owning the one parser): walk `areaAncestors(area)` (`area-agent-command.mjs:2-6`) and return the first resolvable `Repository:`/`Worktree:` line. Replace `areaDirectory` callers at `server.mjs:2339` (worker), `2237` (Describe work), `510` (sidebar), `4508` (brain prompt), and make `programs.mjs:44-59` call the same function so Programs and workers agree.
- `spawnGoalSession`: `const dir = workingDirectory || (await workRepository(area));` and when both are null return `{ status: 409, error: "goal <slug>: <area> and its parent Areas bind no repository. Add `- Repository: <absolute or ~ path>` under ## Resources in <TREES_ROOT>/<area>/<leaf>.md, or pass --path <directory> for each step.\n" + launchHelpLines-style hint }`. Apply the same check inside `startPipeline`/`appendPipelineSteps` before any record is written (same contract as `missingStepLaunches`, `server.mjs:2612-2626`), so a refused start leaves no record and no session.
- Record the resolved directory: add `cwd` to the attempt (`pipeline-record.mjs` attempt shape) and set tmux option `@tangent_cwd`; include `- Working directory: <dir>` in `goalPrompt` sources; add `launchSource`-style `pathSource: "step" | "area:<area>" ` on the assignment (mirrors ADR-0035's `launchSource`).
- Disclose it in the start response and `tangent goal start` output, next to the harness disclosure rows (`discloseAssignmentLaunch`).

Touches: `server.mjs` (resolver, spawnGoalSession, startPipeline, appendPipelineSteps, goalPrompt, brainPrompt), `programs.mjs`, `area-agent-command.mjs` (shared parser, tolerate annotated lines), `pipeline-record.mjs` (attempt `cwd`), `goal.ts` (print directory), tests `launch-environment-http.test.mjs`, `pipeline-record.test.mjs`, `brain-worker-launch-http.test.mjs`.

Trade-offs: knowledge-only Areas (`neara` 97 steps, `neara/onboarding` 18, `neara/enums` 18) stop starting until they bind something. Making the vault an explicit binding (`- Repository: ~/.tangent/trees`) restores them without silence. Brain-dispatched starts get a machine-readable refusal they can act on (bind the Area via a vault edit, or pass `--path`).

Migration: a read-only audit command (`tangent area list --repos` or a one-off script) listing every Area with started steps and no resolvable binding (17 today); Julian or a brain adds `- Repository:` lines through `tangent vault commit`; fix `speedrun` (move the annotation off the line or make the parser stop at ` (`), fix `pgande` (`- Repository: ~/Projects/polez`). Existing records with `path: null` stay valid; `cwd` on attempts is additive.

## Candidate B: Warn and disclose, do not refuse

Mechanism: same resolver and inheritance as A, but the vault-folder fallback stays; the server emits a warning row (`"worker starts in the Area folder ~/.tangent/trees/<area>; this Area binds no repository"`) through the existing `printLaunchWarnings` path (`goal.ts:127`) and the launch disclosure, stamps `@tangent_cwd`, and the Work table marks sessions whose `cwd` starts with `TREES_ROOT` (the browser already receives `cwd` from `/api/sessions`).

Touches: `server.mjs` (resolver, disclosure), `public/work-*` views, `goal.ts`.

Trade-offs: zero breakage; Julian's "never" becomes "visible when violated". Brains reading a warning tend to ignore it (ADR-0035's context: 121 of 634 assignments ran on the wrong harness while the Area declared otherwise), so the silent-wrong-directory failure only becomes a visible-wrong-directory failure.

Migration: none required; audit as in A remains useful.

## Candidate C: Repository as a declared field in `tangent.environment.v1`, not a prose line

Mechanism: extend the Area environment block (`launch-environment.mjs`, already the home of `defaults.launch` and `defaults.brain`) with `"repository": "~/Projects/x"` (and optional `"worktree"`), inherited like launch defaults; `upsertEnvironmentLaunch` grows an `upsertEnvironmentRepository`; the launch picker shows and edits it; the prose `- Repository:` line stays as fallback for one release, then is removed. Combine with A's refusal and recording.

Touches: `launch-environment.mjs`, `launch-catalog.mjs` (`forArea` inheritance), `launch-routes.mjs`, `public/goal-launch-view.js`, `programs.mjs`, `server.mjs`, vault notes (migration of 5 lines), `README.md` vault rules.

Trade-offs: one authoritative, machine-checked schema and one parser; visible in the picker Julian already uses; bigger change; the rationale doc for `--path` explicitly rejected a per-pane `path` in this block, but a per-Area repository is a different field (the step directory would still override it).

Migration: script reads each note's `## Resources` line, writes the block, commits with `tangent vault commit`; vault README rule text updated.

## Candidate D: Brain directory (decision needed, independent of A-C)

- D1 `brain cwd = repoRoot` (`server.mjs:112`, the checkout serving port 4321): matches Julian's words; brain gets the tangent `CLAUDE.md` and `.claude/skills` (engineering skills for the tangent codebase, plus the mandatory `tangent search` rule that indexes the tangent repo, not the Area's repo). Brains for neara Areas would run `git status`, `npm test`, etc. against the tangent checkout by accident; `inheritedInstructionFiles` in `brainPrompt` would then need to read the Area's work repo, not cwd.
- D2 `brain cwd = TREES_ROOT` (`~/.tangent/trees`): brain sees the vault root and every Area folder relative to it; a vault-root `.claude/skills` or `.agents` (none exists today) would be discovered; matches "skills live per Area in Tangent" better than D1 if per-Area skills are pointed to by the brain prompt (`Area source:` lines already list Area notes). The vault root has no `AGENTS.md`/`CLAUDE.md` today, so the brain would get only global instructions.
- D3 status quo (bound repo or Area folder) with `Repository: none bound` in the prompt: gives a brain direct access to the work repo for read-only inspection (ADR-0024 allows reads), which Julian's "delegate every product repository write" boundary tolerates.

Recommendation shape: pick D1 or D2 as one constant and pass the work repository to the brain by prompt (`Repository: <path>` already exists) and to `inheritedInstructionFiles`, so the brain's cwd and the Area's work repo are decoupled. Whichever is chosen, `spawnBrainSession` line 4804 becomes a constant and the Area binding stops affecting brain placement.

## Counterexamples

- **The tangent Area is the exception to "never in the tangent repository".** `otto/tangent/tangent.md:99` binds `~/Projects/otto-tangent`; 310 started steps and 5 live workers run there correctly. A naive rule "refuse cwd == repoRoot" breaks all Tangent engineering work. The rule must be "cwd == the Area's work repository", and for `otto/tangent` that equals `repoRoot`.
- **Unbound Areas that dispatch with `--path` are correct today.** `neara/portland` binds nothing but ran 44 steps in `~/Projects/delivery` and two delivery worktrees via per-step `path`; `neara` ran 8 in `~/Projects/polez` worktrees. A refusal keyed on "Area binds no repository" must accept an explicit step path as satisfying the invariant. The portland brain itself, however, would still have nowhere to open under D3.
- **Knowledge Areas with no code.** `neara` (97 steps), `neara/onboarding` (18), `neara/enums` (18), `neara/hackathon/embedded-js/*` (42) did vault-document work in vault folders. A strict refusal with no "vault is the repository" escape hatch blocks that work; a silent fallback is what produced the `.claude/settings.local.json` litter inside the vault.
- **Nested Areas.** `otto/dnd/testing` and `otto/dnd/players` are children of a bound Area yet ran in vault folders (13 + 8 transcripts). Any design that keeps exact-Area lookup keeps this bug; any design that inherits must decide what a child that needs a different repo does (answer today: `--path` per step, or its own line).
- **Annotated and prose bindings.** `speedrun.md` `- Worktree: /Users/.../pgande-speedrun (tracks origin/pgande-staging; recreated by the agent if missing)` resolves to null though the directory exists; `pgande.md` `- Repository \`$POLEZ\` — dart` never matches. A parser that only tightens will silently drop more bindings; a refusal that names the unparsed line is the safe failure.
- **Two parsers already disagree.** `noteResource` tolerates backticks; `programDirectory` requires `- ` and no backticks. Fixing only `areaDirectory` leaves Programs and triggers (ADR-0030) on the other behaviour (the live speedrun trigger sits in the vault folder today).
- **Reattach never changes cwd.** `spawnGoalSession` re-primes an existing pane (`server.mjs:2311-2335`) without touching its directory; a worker that `cd`'d elsewhere, or a session created before a binding was added, keeps its old cwd. A spawn-time invariant alone cannot claim "worker cwd is always X"; only a stamped `@tangent_cwd` plus the reconciler could.
- **Continuation must carry the directory.** `continueWorkerSession` (`server.mjs:3903`) already had one regression (25387bd) where the continued copy fell back to the Area repository; any new resolver has three call sites to keep aligned: `startPipelineStep`, `continueWorkerSession`, solo start.
- **The CLI resolves `--path` in the caller's shell.** A brain running in `~/.tangent/trees/neara/portland` that passes a relative `--path src` gets `~/.tangent/trees/neara/portland/src`, which then fails `existsSync` loudly (good), but a brain in the tangent repo under D1 passing `--path packages/x` would silently target the tangent checkout.
- **Brain-in-tangent-repo vs Area skills in the vault conflict.** Per-Area `.agents`/`.claude` folders would live under `~/.tangent/trees/<area>`; a brain whose cwd is `~/Projects/otto-tangent` will not discover them by cwd. Either the brain prompt names the skill files (it already names Area sources by absolute path) or the brain's cwd must be inside the vault (D2), not the tangent repo.
- **ADR-0035 precedent cuts both ways.** It chose "lend and disclose" over "refuse" for harness; the same argument (brains type wrong values from memory) applies to directories, but a wrong directory is not disclosed anywhere today, and unlike harness there is no brain-owned value to lend.

## Unknowns

- **What Julian means by "the tangent repository" for brains**: `~/Projects/otto-tangent` (the code) or `~/.tangent/trees` (the vault where Areas and their future `.agents`/`.claude` folders live). Memo 2 ties it to per-Area skill folders, which live in the vault. Establish by asking one question with both paths named.
- **Harness skill discovery by cwd**: I assume Claude Code loads `.claude/skills` and `CLAUDE.md` from the cwd (and `CLAUDE.md` from ancestors) plus `CLAUDE_CONFIG_DIR`; whether it walks ancestors for skills, and what codex (`AGENTS.md` upward) and pi do, is not established from this repo. Establish with a probe session per harness in a temp dir with a nested `.claude/skills`.
- **Exact cwd of the 224 vault-folder steps at the time they ran**: inferred from today's code and today's notes; transcripts corroborate the neara/hackathon, neara, enums, and dnd-children cases, but steps before 2026-08-17 were not individually matched to transcripts. Establish by joining pipeline `attempts[].session` to transcript cwd (Claude project dir names; codex `session_meta.cwd`) after refreshing the Usage index.
- **Whether the `speedrun` Worktree line ever resolved**: I inferred null from the regex; not executed. Establish with a one-line node script calling `noteResource` on the note text.
- **Trigger worker cwd resolution**: the trigger runtime code was not read (grep found `trigger` only in `programs.mjs`, `server.mjs`, `area-brain-domain.mjs`, `action-telemetry.mjs`); the live trigger's vault-folder cwd was observed but its fallback path was not traced.
- **Codex `cwd` count for `~/Projects/otto-tangent` (678 rollouts)** mixes the tangent brain's 324 generations, 310 workers, and Julian's own sessions; no per-role split was made.
- **Whether any Area intentionally wants workers in the vault** (pure document work). If yes, the refusal in Candidate A needs an explicit `- Repository: ~/.tangent/trees` (or a `vault` keyword) so the choice is written, not defaulted.

## Sources

- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/server.mjs (lines 112, 146, 284-301, 358-359, 429-471, 505-518, 580-604, 1598-1606, 1660-1790, 2219-2356, 2569-2580, 2650-2676, 2769, 2833, 2887, 3431, 3903, 4501-4595, 4799-4839, 4985-5020, 5114, 5954, 6718)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-agent-command.mjs:1-13
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/programs.mjs:44-59,95-156,186-199
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-brain-domain.mjs:40-72
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/terminal-transport.mjs:13-48
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-routes.mjs:22-31
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/shell-state-routes.mjs:7
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-launch.mjs (grep: no directory logic)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/agent-context.mjs (grep: no directory logic)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-operations.mjs (vault directory ops only)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/launch-environment.mjs (grep: no repository field)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/workspace/ (AGENTS.md, CLAUDE.md)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/goal-launch-view.js:151,278,292,321,616
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/program-view.js:124,134,148
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/shell-coordinator.js:350,400
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/launch-environment-http.test.mjs:180-245
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/launch-environment.test.mjs:162
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pipeline-record.test.mjs:145,169
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-agent-command.test.mjs:11
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/goal.ts:15,105-130,166,214-262,479
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/brain.ts:8-19
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/study.ts:42
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-operating-vision/user-intent.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-work-contract/design-record.md:335-352
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-navigation-model/design-record.md (grep: no repository rules)
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0030-area-triggers.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0033-area-brain-operating-model.md:16
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0024-area-brain.md:19
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0026-study-partner-agent-session.md:17
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md:20
- /Users/julianotto/Projects/otto-tangent/.claude/skills/ (mark-agent-mistake, setup-tangent-eval, verify-app)
- ~/.tangent/trees/otto/tangent/tangent.md (lines 97-104 Resources; Knowledge section on CLAUDE_CONFIG_DIR)
- ~/.tangent/trees/otto/otto.md:18-45
- ~/.tangent/trees/neara/neara.md:35-45
- ~/.tangent/trees/neara/pgande/pgande.md:39-47
- ~/.tangent/trees/neara/pgande/speedrun/speedrun.md (Resources)
- ~/.tangent/trees/neara/pgande/standards/standards.md (Resources)
- ~/.tangent/trees/neara/hackathon/live-edit/live-edit.md (Resources)
- ~/.tangent/trees/otto/dnd/dnd.md (Resources; vault git log -p)
- ~/.tangent/trees/README.md:68-90
- ~/.tangent/trees/harnesses.md:1-60,279-284
- ~/.tangent/trees/otto/tangent/design-goal-launch-environments.md:26,32,115,154,197,224,226
- ~/.tangent/trees/otto/tangent/goal-allow-brains-to-spawn-worker-agents-in-any-arbit.md
- ~/.tangent/trees/otto/tangent/rationale-allow-brains-to-spawn-worker-agents-in-any-arbit.md
- ~/.tangent/trees/.claude/settings.local.json and empty .claude/ dirs under neara, neara/portland, neara/hackathon, neara/hackathon/embedded-js
- ~/.tangent/agent-shell/pipelines/**/*.json (285 records, jq over steps/assignments/attempts)
- ~/.tangent/agent-shell/brains/*/brain.json and brains/*/*/brain.json (area, status, generations, generation keys)
- ~/.tangent/usage/global/index/usage.sqlite (sessions table; stale at 2026-08-16)
- ~/.codex/sessions/2026/08/**/*.jsonl (session_meta cwd counts)
- ~/.claude/projects and ~/.claude-otto/projects (transcript counts by cwd-encoded dir since 2026-08-17)
- tmux list-sessions -F '#{session_name} #{pane_current_path} #{@tangent_kind} #{@tangent_area}' (live on 2026-08-27)
- ~/.claude-otto/skills -> ~/.claude/skills symlink

# harness-resume: tie each Goal attempt to its harness conversation id and the exact resume command, and show the agent's token context

## Observed

## 1. The harness registry knows commands and args, nothing about sessions or resume

- `~/.tangent/trees/harnesses.md` holds one fenced block `tangent.harnesses.v1` with `modelSets`, `effortSets`, and `harnesses`. Each harness is `{ id, label, command, modelSet?, effortSet? }`. Registered harness ids (Observed): `claude` (command `claude`), `claude-otto` (`claude-otto`), `codex` (`codex`), `codex-gw` (`codex-gw`), `claude-gw` (`claude-gw --strict-mcp-config --mcp-config /Users/julianotto/.config/neara-harness/claudecode/mcp-fibery.json`), `opencode` (`opencode-gw`), `pi-code` (`pi-code`), `agy` (`agy`), `agyd` (`agyd`). No entry has any resume, session, transcript, or profile field. The Document text says "Tangent never rewrites these strings."
- `packages/agent-shell/app/launch-environment.mjs:22-49` parses that block; validation at :33-36 and :134-149 only requires `id` and `command` and a known `modelSet`. Unknown extra keys on a harness entry are neither rejected nor read (Observed from the code; no test for extra keys inspected).
- Command composition: `launch-environment.mjs:99-120` joins `harness.command`, `model.args`, `effort.args`. The composed command is stored per assignment as `command` and `label` (`server.mjs:2779-2781` in `startPipelineStep`).
- Counter to "never rewrites": `packages/agent-shell/app/agent-command.mjs:2-7` `withDefaultModel` appends ` --model default` to any command whose first word contains `claude` and lacks `--model`. It is applied at every prime: `server.mjs:2191`, `:2204`, `:4888`. So Tangent already appends an argument to claude launches.

## 2. What the harness commands actually are on this machine (Observed via `which`)

- `claude` -> `/Users/julianotto/.local/bin/claude`. Transcripts under `~/.claude/projects/<cwd-key>/<sessionId>.jsonl`.
- `claude-otto` is a zsh alias: `CLAUDE_CONFIG_DIR=~/.claude-otto claude --verbose --dangerously-skip-permissions`. Transcripts under `~/.claude-otto/projects/<cwd-key>/<sessionId>.jsonl`. `spawnGoalSession` deliberately starts a login shell so aliases resolve (`server.mjs:2340-2342`: "No command: tmux runs the login shell, so aliases (claude-otto) resolve").
- `codex` -> `/opt/homebrew/bin/codex`; `codex-gw` -> `/Users/julianotto/.local/bin/codex-gw` = `exec harness run codex "$@"` (neara-harness). `neara_harness/harnesses/codex.py:3`: "The gateway variant runs on the real CODEX_HOME", so rollouts for both live under `~/.codex/sessions/YYYY/MM/DD/rollout-<local-time>-<uuid>.jsonl`.
- `claude-gw` -> `exec harness run claudecode "$@"`; `claudecode.py:1-5` says it uses "the user's own configuration, with the gateway riding a settings layer" via `--settings`, so transcripts land under `~/.claude/projects/`.
- `opencode-gw` -> `exec harness run opencode`. `opencode --help` shows `-c, --continue`, `-s, --session <id>`, `--fork`, `opencode session`, `opencode export [sessionID]`.
- `pi-code` is a zsh alias to `/Users/julianotto/.nvm/versions/node/v22.23.1/bin/node .../bin/pi`. Sessions under `~/.pi/agent/sessions/<cwd with / replaced by ->/<ISO-time>_<uuid>.jsonl` (Observed: `~/.pi/agent/sessions/--Users-julianotto-Projects-delivery--/2026-08-27T01-19-39-441Z_01a040cd-1db1-77a6-b3d2-cf64311f1d7d.jsonl`). `pi.py:123` confirms "pi's real config directory ... sessions" is shared by the gateway variant.
- `agy` is a Go binary at `~/.local/bin/agy`; `agyd` = `agy --dangerously-skip-permissions`. `agy --help` shows `--conversation  Resume a previous conversation by ID`. Its state is under `~/.gemini/antigravity-cli/` (`conversations/`, `conversation_summaries.db`, `history.jsonl`). Not covered by Usage.
- Note: the shell alias `pi` is `ssh julian@192.168.4.28`, unrelated to `pi-code`.

## 3. Resume flags per harness (Observed from `--help`)

- Claude Code: `-r, --resume [value]` ("Resume a conversation by session ID, or open interactive picker with optional search term"); `-c, --continue` ("Continue the most recent conversation in the current directory"); `--session-id <uuid>` ("Use a specific session ID for the conversation (must be a valid UUID)"); `--fork-session`; `-n, --name <name>`.
- Codex: `codex resume [OPTIONS] [SESSION_ID] [PROMPT]` ("Session id (UUID) or session name"); `--last`; `--all` ("disables cwd filtering"); also `codex fork`, `codex archive|unarchive|delete <id or name>`, `codex queue`. No top-level `--session-id` for the TUI.
- Pi: `--continue, -c`; `--resume, -r` (picker); `--session <path|id>` ("Use specific session file or partial UUID"); `--session-id <id>` ("Use exact project session ID, creating it if missing"); `--fork`; `--session-dir <dir>`; `--name`.
- Gemini CLI: `packages/agent-runtime/src/agent.ts:174-176` states "Gemini does not expose a compatible resume contract."

## 4. Where a provider session id is written on disk, and when

- Claude: file name is the session id; the first records carry `sessionId` (`{"type":"mode",...,"sessionId":"bad22f6c-..."}`) and the first `user` record has `sessionId`, `cwd`, `version`, `gitBranch`, `timestamp` (Observed on `~/.claude-otto/projects/-Users-julianotto-Projects-otto-tangent/e684f2dc-....jsonl`). Also `~/.claude-otto/.claude.json` `projects["/Users/julianotto/Projects/otto-tangent"].lastSessionId` = `e684f2dc-...` (one value per cwd per profile).
- Codex: first line is `session_meta` with `payload.id`, `payload.session_id`, `payload.cwd`, `payload.timestamp`, `originator: "codex-tui"`, `source: "cli"`, `thread_source: "user"`. `~/.codex/history.jsonl` maps `session_id` to user prompt `text` and `ts`.
- Pi: first line `{"type":"session","version":3,"id":"<uuid>","timestamp":..,"cwd":..}`.
- Timing (Observed on real attempts): codex `session_meta.timestamp` 2026-08-26T20:29:24.203Z vs queue attempt `startedAt` 2026-08-26T20:29:24.072Z (131 ms); pi first line 2026-08-26T21:16:31.737Z vs attempt 21:16:31.477Z (260 ms), 01:19:39.441Z vs 01:19:38.817Z (624 ms); claude first `user` record 2026-08-26T19:57:40.605Z vs attempt 19:57:35.949Z (4.7 s; Claude writes the file when the first prompt is submitted, which Tangent does right after boot).
- Codex creates two rollouts per launch about 200 ms apart: the main thread (`thread_source: "user"`, 1687 lines) and a `guardian` subagent thread (`thread_source: "subagent"`, `source: {"subagent":{"other":"guardian"}}`, `parent_thread_id` = main id). Both contain the step prompt text.
- Live processes do not hold the transcript open: `lsof` on the pane pids 54593 (claude), 44283 (codex), 75895 (pi) and their children found no `.jsonl` (Observed once, 2026-08-27).
- The pane never shows a session id: claude statusline `[Opus 5] ▓░░░ 16% (158k/1000k) $8.16 ⌛threads ~/Projects/otto-tangent`; codex footer `gpt-5.6-sol max · ~/Projects/otto-dnd` (`fixtures/panes/codex-idle.txt`); pi footer `↑43k ↓20k R1.1M CH98.8% 6.8%/1.0M (auto) resetdata-glm zai/glm-5.2 • xhigh` (`fixtures/panes/pi-working.txt`).
- `pane_current_command` is not a harness id: live tmux shows `2.1.246` for claude, `codex` for codex, `node` for pi (Observed via `tmux list-sessions -F`). `pane-state.mjs:9-12` already says this.
- Claude Code hooks and statusline receive `session_id` / `transcript_path` on stdin, but `~/.claude-otto/statusline.sh` prints only model, fill, cost, cwd and writes `~/.wt/sessions/<name>.tokens` only for `wt-*` sessions; `~/.claude/settings.json` installs `~/.wt/hooks/wt-hook.sh` on SessionStart/SessionEnd/Notification, which exits unless the tmux session is `wt-*`. `~/.claude-otto/settings.json` has no hooks. Root `CLAUDE.md` says: "Do not reintroduce provider hook installation, hook recording, or hook allowlist tracking." `packages/hooks` still exists as a dist-only package exporting `providers/claude.js`, `providers/codex.js`, `install.js`.

## 5. What Usage already knows

- `tangent.usage.session.v1` (`packages/usage-core/src/schema/index.ts:182-197`) has `id` (`claude:<uuid>`, `codex:<uuid>`), `provider`, `providerSessionId`, `transcriptPath`, `cwd`, `gitBranch`, `startedAt`, `endedAt`, `status`, `counts`, `metrics.tokens.context` (Observed via `tangent usage sessions get latest --json`: `providerSessionId: "bad22f6c-..."`, `transcriptPath: "/Users/julianotto/.claude-otto/projects/.../bad22f6c-....jsonl"`, `tokens.context: 155877`).
- Discovery: `claudeHomes()` unions every `~/.claude*` profile with a `projects/` dir (`usage-providers/src/providers/claude/native/discover.ts:26-38`); `claudeProjectKey` replaces `/` and `.` with `-` (:16-18). Codex discovery reads `payload.cwd` from the first 200 lines (`codex/native/discover.ts:24-45`). Gemini via `~/.gemini/tmp`. Providers supported: claude, codex, gemini (`usage-providers/src/providers/index.ts:151`). Pi, opencode, agy are not indexed.
- Coverage today for otto-tangent with `--scope all`: `{ claude: 483, codex: 517 }` sessions.
- CLI filters (`packages/usage/src/cli/spec.ts:34-44`): `sessions list [repo] --provider --date --since --until --source --json`; `sessions get <session|latest>`; `messages query --session --role --min-chars --contains --limit`. There is no `--cwd` filter and no tmux field anywhere in usage (grep for `tmux` in usage-providers/usage-core/usage returned nothing).
- Architecture rule: `docs/architecture/package-boundaries.md:55` "agent-shell must not import Eval, Usage, Rollup, Search, or Threads"; `dependency-graph.md:15` allows agent-shell -> core, agent-runtime, repo only. `design-worker-context-handover.md:105-108` already rejected reading the Usage index for fill for exactly this reason.
- `@tangent/agent-runtime` (`src/agent.ts:11-13, :72, :124-132`) has a headless resume contract: `AgentCliSession = { kind: "fresh"; id? } | { kind: "resume"; id }`; claude gets `--resume <id>` (print mode), codex gets `exec resume <id>`; `sessionIdFromEvent` reads `session_id|sessionId|thread_id|threadId` (:247-249). Only `packages/eval` calls `runAgent` today.

## 6. What Tangent records about a session today

- tmux options set at spawn (`server.mjs:2343-2357`): `@tangent_area`, `@tangent_goal`, `@tangent_kind goal`, `@tangent_phase`, `@tangent_launch_command`, `@tangent_launch` (label), `@tangent_launch_ref` (`claude-otto/opus-5`), `@tangent_pipeline`, `@tangent_step`, `@tangent_assignment`, `@tangent_attempt`, plus `@tangent_agent_shell_instance` (`session-ownership.mjs`). `GET /api/sessions` reads them (`server.mjs:279-336` `loadSessions`) and adds pane state and `context` from `pane-observer.mjs:81`; payload also carries `contextHandoverTokens` (`server.mjs:6545`). Session sidecars `~/.tangent/agent-shell/session-owners/<sha256>.json` are `{ schema: "agent-shell-session-owner.v1", session, instanceId, claimedAt }`. The tmux `#{session_id}` used by ownership is tmux's `$N`, not a provider id.
- Queue record `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `area-goal-queue.v2`: each assignment has `instruction, launch {harness, model, effort}, command, label, launchSource, path, kind, status, session, startedAt, endedAt, handover, attempts[], reports[], launchDisclosure, continuations[]?`. Each attempt (`server.mjs:2849-2862`) is `{ id: uuid, kind: "managed" | nextAttemptKind ("julian-emergency" at :2957), session, instanceId, target (tmux $id), resolvedLaunch { ref, command, label }, startedAt, endedAt, report }`. Nothing names a provider session or transcript. The same tmux name is reused across attempts: `tangent-finish-and-prove-tangent-around-the-area-brain-s7` has 5 attempts, each a fresh harness process.
- Solo continuation record `~/.tangent/agent-shell/continuations/<area>/<slug>.json` schema `goal-continuation.v1`: `{ goal, area, slug, session, command, label, continuations[], contextReminders{} }`.
- Brain record `area-brain.v3`: generations carry `session`, `startedAt`, `endedAt`, `handover`, `resolvedLaunch { ref, label, command, sourceArea, mode }`. No provider id.
- Goal note frontmatter written by the server: `writeGoalBinding` (`server.mjs:1149-1155`) sets only `status`, `session`, `waiting_on` through `withFrontmatterLine` (:1135-1144). `readAreaGoals` (:766-800) reads `type, status, done_when|outcome, waiting_on, due, session`. Vault README (`~/.tangent/trees/README.md`) lists allowed frontmatter "and no others" for node notes and outcomes; `session` is the one mechanical binding field, and "notes contain no dates or conversation IDs" (History and provenance). The README promises a `Tangent-Conversation:` commit trailer "when known", but `packages/agent-shell/src/cli/commands/vault.ts:41-44` writes only `Tangent-Area` and `Tangent-Tmux`.
- `packages/agent-shell/app/agent-context.mjs` (`tangent-agent-context.v1`, `GET /api/agents/context`, `tangent agent context [session]`) projects brain/queue/Goal facts for a session name, including `assignment.launch`, `command`, `attempt`; no provider id (`:126-160`). `command-provenance.mjs:6-18` resolves an actor by tmux name only.
- Goal reader (`public/document-reader-view.js:192`) renders "Attempt history" as `<session name> · <status> · <harness/model/effort>` with no verbs; `goal-detail.mjs:74-83` offers commands `read`, `start`, `change-agent`, `status` only. "Open agent" (`document-reader-view.js:126,152`) exists only while a live session exists. `tangent goal show` (`src/cli/commands/goal.ts:331-356`) prints queue assignments, not attempts.
- The prompt Tangent types contains the tmux name only inside the rationale dossier line: `rationale-dossier.mjs:31-33` emits `Generating session: <tmux session>, the repository path, and the date`, included by `pipelineStepPrompt` (`server.mjs:1763`). Marker hit rate on 12 recent claude attempts in otto/tangent: 5 sessions matched a transcript, 7 did not (the s6 transcript, 12,535 chars, holds the whole step prompt but no dossier block at all). `goalPrompt` for solo and continued sessions passes no session name; `brainPrompt` (`server.mjs:4502`) names none.

## 7. Token context today (ADR-0028)

- `pane-state.mjs:27-35` (pi: `(\d+(?:\.\d+)?)%\/(\d+(?:\.\d+)?)M`) and `:46-53` (claude: `\((\d+(?:\.\d+)?)k\/(\d+(?:\.\d+)?)k\)`, which depends on Julian's statusline); codex has no pattern (:60). `parseContextFill` (:185-199) returns `{ usedTokens, windowTokens }` or null.
- `pane-observer.mjs:38-40` parses fill on every classify pass (min 1200 ms between samples per pane, `capture-pane` already taken for state), so fill costs nothing extra; `/api/sessions` already carries `session.context` for every owned session and `step.context` (`server.mjs:3986`).
- The desk hides it below threshold: `public/work-desk-view.js:1176-1179` `deskFillLabel` returns "" unless `usedTokens >= contextHandoverTokens` (300000), else `${Math.round(usedTokens/1000)}k`.
- The reminder text now says `tangent handover "<facts>"` and "Do not replace yourself" (`server.mjs:5493-5495`), which differs from ADR-0028's `tangent goal handover --continue`. `tangent handover` is a top-level command (`src/cli/spec.ts:6-16`, `commands/handover.ts`).
- Usage has a second measure: `metrics.tokens.context` per session (155877 for the latest claude session), computed from transcripts.

## Gap

Julian wants, per Goal, the harness conversation ids and the exact command that resumes each conversation, kept on the Goal so he can always resume, and the agent's token context visible per Goal.

Today:
- No record anywhere in Tangent (queue attempt, continuation record, brain generation, tmux options, Goal frontmatter, vault commit trailers) holds a provider session id, transcript path, or resume command. The only join key is the tmux session name, which is reused across attempts (5 attempts on one name observed) and dies with the tmux session.
- The registry (`harnesses.md`) knows how to start a harness, not how to resume one. Resume syntax differs per harness (`claude --resume <uuid>` under the right `CLAUDE_CONFIG_DIR`, `codex resume <uuid>`, `pi --session <uuid|path>`, `opencode -s <id>`, `agy --conversation <id>`, none for gemini) and the command prefix must keep the alias or wrapper (`claude-otto`, `claude-gw --strict-mcp-config ...`) plus, for claude, the same `--model`/`--effort` args if the resumed session should keep them.
- The id exists on disk within roughly 0.1 to 5 s of `attempt.startedAt`, in a per-harness location keyed by cwd, but nothing in Agent Shell reads those directories, and the architecture forbids importing Usage, which already indexes claude and codex (not pi, opencode, agy).
- "Resume" in Agent Shell today means reattaching to a live tmux session (`design-goal-launch-environments.md:199-203`) or waking a brain from its record; it never means restarting a dead harness conversation.
- Token context is captured for every claude and pi pane every sample, carried on `/api/sessions`, but shown only at or above 300k on the desk row and never in the Goal reader; codex shows nothing; Usage's per-session `tokens.context` is a second, unjoined measure.
- The Goal reader lists attempts with no verbs, and `tangent goal show` prints no attempts, so even a stored resume command would have no surface yet.

## Candidates

## A. Tangent records the provider session on the attempt and shows a Resume verb (recommended core)

Mechanism:
- Add a pure module `packages/agent-shell/app/harness-session.mjs` with a per-harness-family table, keyed the same way `PANE_SIGNATURES` is: how to find the transcript for a launch (`claude`: `${CLAUDE_CONFIG_DIR or ~/.claude}/projects/${claudeProjectKey(cwd)}/*.jsonl`, key rule `/` and `.` -> `-`; `codex`: `~/.codex/sessions/**/rollout-*.jsonl` with `session_meta.payload.cwd === cwd` and `thread_source === "user"`; `pi`: `~/.pi/agent/sessions/${cwd with / -> -}/*.jsonl` first line `type: "session"`), how to read `{ providerSessionId, transcriptPath, startedAt }`, and how to render the resume command from the attempt's `resolvedLaunch.command` (`claude-otto --model claude-opus-5` -> `claude-otto --model claude-opus-5 --resume <uuid>`; `codex ... ` -> `codex resume <uuid>`; `pi-code ...` -> `pi-code ... --session <uuid>`). The family comes from the first word of the command, the way `withDefaultModel` already decides "launches claude".
- Discovery runs in the existing reconcile pass (`reconcileGoals`, same 10 s throttle as `reconcileContextHandovers`) for each attempt with `startedAt` and no `providerSession`: candidate files whose start time is within a window after `attempt.startedAt` (observed deltas 0.1 to 5 s; use 60 s) and whose cwd equals the tmux `session_path` from `loadSessions`; if exactly one candidate, write `attempt.providerSession = { provider, id, transcriptPath, discoveredAt, method: "time-cwd" }`; if several, keep them as `candidates` and let the second signal (the `Generating session: <tmux>` marker, or the first user message equal to the typed prompt's first 200 chars) decide. Persist through `writePipeline`; brain generations get the same field in `brain-record.mjs`; solo sessions through `continuation-record.mjs`.
- Or make discovery deterministic by assigning the id at launch where the harness allows it: claude `--session-id <uuid>` and pi `--session-id <id>` accept a Tangent-chosen uuid (Assumption: pi's id format is a uuid; Observed format `01a040cd-...` is uuid-shaped). Append the flag at prime time exactly as `withDefaultModel` appends `--model default`. Codex has no such flag, so codex stays on discovery.
- Surface: `goal-detail.mjs` adds `resume` per attempt (`{ command, cwd, live: boolean }`), the Goal reader's Attempt history row gets `Resume` (copies the command, or starts a new owned tmux session in the attempt's cwd and types the command through `primeGoalSession` with `launch: false` so it stays type-but-never-submit), `tangent goal show` prints `attempt <n>: <session> <provider>:<id> resume: <command>`, and `tangent agent context` includes it.

Touches: `pipeline-record.mjs` (attempt shape), `server.mjs` reconcile and spawn, new `harness-session.mjs` with fixtures under `fixtures/transcripts/`, `goal-detail.mjs`, `document-reader-view.js`, `goal.ts`, `agent-context.mjs`, `public-api.md`, an ADR.

Trade-offs: The id is known only after the harness writes its first record (claude: after the first prompt lands; codex and pi: at boot). Discovery is filesystem reads inside Agent Shell (allowed; no Usage import), but it duplicates the path knowledge in `usage-providers` (`claudeProjectKey`, codex cwd matching); a shared `@tangent/core` helper would be the clean home, but `@tangent/core` "must not learn product schemas" (root CLAUDE.md), so keep it in agent-shell as data with fixture tests. Pre-assigning ids removes ambiguity for claude and pi but edits the launch string the registry says Tangent never rewrites (precedent: `withDefaultModel`).

Migration: purely additive field on attempts; old attempts stay without it. A one-time backfill can run the same discovery over records with `startedAt` after the transcript retention window; the queue's `normalizeQueueRecord` already tolerates unknown fields.

## B. Write the resume line into the Goal note

Mechanism: `writeGoalBinding`-style server write of a `## Sessions` section (or a `resume:` frontmatter key) with one line per attempt: `- <tmux session> · <harness label> · resume: \`<command>\` (cwd <path>)`, committed with `vaultCommit` like the `active` binding.

Touches: `server.mjs:1149-1155` and `editGoalFile`, vault README, every Goal note.

Trade-offs: Julian can read it in Obsidian and it survives a wiped `~/.tangent/agent-shell/`. But it violates the vault rules as written: frontmatter is "and no others" (README), notes carry "no dates or conversation IDs" (README, History and provenance), each mechanical write is a vault commit (churn: one commit per attempt discovery), and the Goal file changing while a worker holds it triggers `goalRevision` mismatch logic (`record.goalRevision`, review reports must match the revision). A body section is less harmful than frontmatter but still commits churn. Better as a projection: the Goal reader already renders server-owned facts above the Markdown, which is what Candidate A uses.

Migration: rewrite of existing Goal notes; risky under the vault's "one save is one commit" rule.

## C. Derive at read time from Usage by matching cwd and time

Mechanism: `goal-detail` or the CLI asks Usage (`tangent usage sessions list --since <startedAt> --json`, or the SQLite index) for the session whose `cwd` equals the attempt's directory and `startedAt` is nearest after `attempt.startedAt`; render `providerSessionId` and build the command.

Trade-offs: No new storage and reuses the existing normalization. But agent-shell must not import Usage (`package-boundaries.md:55`), so it would have to shell out to the CLI or read `usage.sqlite` directly, both slow (sessions list over 1000 files) and lagging the index; Usage does not index pi, opencode, or agy; the codex guardian subagent thread has the same cwd and start time within 200 ms, so time alone picks wrong half the time; and nothing survives if the index is pruned (`tangent usage prune`). The one thing Usage gives that A lacks is `tokens.context` per session and message search, which fits a "Open in Usage" link by `transcriptPath` after A has stored the id.

## D. Capture from inside the harness (hooks or statusline)

Mechanism: a Claude Code `SessionStart` hook or the statusline script (both receive `session_id` and `transcript_path` on stdin) posts to `POST /api/sessions/provider` with `{ tmux: $(tmux display-message -p '#{session_name}'), provider: "claude", id, transcriptPath }`. Pi has an extensions directory (`~/.pi/agent/extensions`) that could do the same (Unknown: pi extension API). Codex has no hook surface observed.

Trade-offs: Exact and immediate for claude, no filesystem scanning. But it reintroduces provider hook installation, which root `CLAUDE.md` forbids, needs per-profile settings edits (`~/.claude/settings.json`, `~/.claude-otto/settings.json`), does nothing for codex, and couples Tangent to the statusline again (the fill parser already has that fragility). Keep as a later accelerator, not the base.

## Token context (all candidates)

The fill is already on `/api/sessions` for every claude and pi pane at no extra cost (parsed from the same `capture-pane` the state poll takes, `pane-observer.mjs:38-40`). "Always show" only changes `deskFillLabel` (`work-desk-view.js:1176-1179`) and adds the number to the Goal reader's Current agent fact and attempt rows; rendering cost is one short string per row. What it cannot do: codex (no pane pattern; the codex footer shows model and cwd only), a claude profile without Julian's statusline, or a dead session (the pane is gone; the last sample is dropped in `enrich` when the session disappears). For dead attempts, persist the last observed `context` on the attempt at `endedAt` (the reconciler already reads `session.context`), and optionally show Usage's `tokens.context` via the stored `transcriptPath` link.

## What "Resume" means by state

- Live tmux session with the harness still running: Resume is the existing Open (attach) verb; nothing new.
- Live tmux session at a shell (agent exited, pane alive): type the resume command into that pane via `primeGoalSession`-style priming, keep `@tangent_*` options, reuse the same attempt or open a new attempt of kind `resumed`.
- Dead tmux session: create a new owned tmux session in the attempt's recorded cwd (`step.path` or Area repository; for pi and claude the cwd must match the session's project key or the id lookup fails, Assumption for claude `--resume <uuid>`, Observed for pi's cwd-keyed directory), type the command, and bind it as a new attempt so the queue, ownership sidecars, and Goal binding stay consistent. Never auto-submit (type-but-never-submit rule).

## Counterexamples

- The tmux session name is not unique per conversation: `tangent-finish-and-prove-tangent-around-the-area-brain-s7` has 5 attempts (`finish-and-prove-tangent-around-the-area-brain.json`), each a fresh codex process with its own rollout. Keying resume by session name (as `agent-context.mjs` and `command-provenance.mjs` do) would return the wrong conversation; the key must be the attempt id.
- Codex writes two rollouts per launch 200 ms apart with the same cwd and the same step prompt text (`01a03fc3-6116...` main, `thread_source: "user"`; `01a03fc3-61c2...` guardian subagent, `thread_source: "subagent"`, `parent_thread_id` = main). Nearest-time or prompt-text matching alone picks the subagent half the time; the filter must require `thread_source === "user"`.
- The `Generating session: <tmux>` marker in the step prompt is not reliable: 7 of 12 recent claude attempts have no transcript containing it (the s6 transcript holds the full 12,535-char prompt with no dossier block), solo `goalPrompt` and `brainPrompt` never include a session name, and continuation prompts pass none. It can only be a tie-breaker.
- The first user message in claude transcripts is stored with newlines stripped (`# Assignment: ...## Done when...`), so matching the typed prompt must normalize whitespace (the pane text comparison in `paneText` already strips whitespace for the same reason).
- Claude Code's project key replaces both `/` and `.` with `-` (`discover.ts:16-18`), so a worktree under `~/.tangent/eval/...` or `~/git-worktrees/delivery/otto-nesc23` maps to a key a naive `/`-only replacement misses; `session_path` from tmux is the cwd to key from, not the Area repository, because a step can run in `--path` (Observed: pi attempts in `/Users/julianotto/git-worktrees/delivery/otto-go95-pgande`).
- `claude-otto` is an alias that sets `CLAUDE_CONFIG_DIR=~/.claude-otto`; a resume command that expands to bare `claude --resume <id>` looks in `~/.claude/projects` and fails. The resume command must keep the registry command word, and the transcript root must be derived per harness id (`claude` -> `~/.claude`, `claude-otto` -> `~/.claude-otto`, `claude-gw` -> `~/.claude` per `claudecode.py`), which the registry does not declare today.
- `withDefaultModel` (`agent-command.mjs:2-7`) already rewrites claude launches, contradicting the registry Document's "Tangent never rewrites these strings"; any `--session-id` injection must go through the same one function or the two rules diverge.
- `lsof` on live claude, codex, and pi processes shows no open `.jsonl`, so "find the transcript from the process" does not work.
- Vault README forbids conversation ids in notes and unknown frontmatter keys, and `goalRevision` is compared at report time, so writing resume lines into the Goal file (Candidate B) changes a revision workers are judged against.
- `package-boundaries.md:55` forbids agent-shell importing Usage; `design-worker-context-handover.md:105-108` already rejected the Usage path for fill on that ground.
- Root `CLAUDE.md`: "Do not reintroduce provider hook installation, hook recording, or hook allowlist tracking" blocks Candidate D as a base mechanism; the existing wt hooks and statusline only act on `wt-*` sessions.
- The codex pane has no context pattern (`pane-state.mjs:60`), and the claude pattern reads Julian's statusline, so "always show tokens" is harness-conditional and profile-conditional.
- Pi's session directory is keyed by cwd (`--Users-julianotto-Projects-delivery--`), and `--session <partial uuid>` resolves inside that directory (Assumption from help text), so a resume from another cwd needs the full path form `--session <path>` or `--session-dir`.
- The reminder text in `reconcileContextHandovers` (`server.mjs:5493-5495`) no longer matches ADR-0028 (`tangent handover` instead of `tangent goal handover --continue`); any ADR for this theme should reference the current verb.

## Unknowns

- Whether `claude --resume <uuid>` finds a session from a different cwd (help text for `-c` says "in the current directory"; `-r` says "by session ID" only). Establish by resuming a finished claude-otto session id from `/tmp` with `--print --max-turns 0` or by reading Claude Code's session lookup code; cheap to test once.
- Whether `codex resume <uuid>` works outside the session's cwd (picker filters by cwd; `--all` lifts it). Test with a finished rollout id from another directory.
- Whether pi `--session <uuid>` resolves outside the cwd-keyed directory, and whether `--session-id <id>` accepts a Tangent-chosen uuid. Read pi's session lookup in `~/.nvm/versions/node/v22.23.1/lib/node_modules/@mariozechner/pi-coding-agent` or test.
- Why 7 of 12 recent claude attempts have no transcript with the dossier marker although `pipelineStepPrompt` always emits it: check the running server's deployed commit at 2026-08-26T19:57 (`/api/state` `deployedCommit`) against `8824e01` and whether those steps were delivered as continuations into an existing session (`continueFromAssignmentId`).
- Whether a `--session-id` appended to a claude launch survives `--verbose --dangerously-skip-permissions` alias expansion and the gateway `processWrapper` (`neara-claudecode-launch`); test with `claude-gw`.
- Pi extension API for a SessionStart-style callback (`~/.pi/agent/extensions` exists; contents not inspected).
- How agy stores conversation ids (`~/.gemini/antigravity-cli/conversations/`, `history.jsonl` not inspected) and whether `--conversation` needs a cwd.
- Whether the Usage index mode used by `tangent usage sessions get` reindexes on demand (`index: "auto"` semantics not located in `usage-index-sqlite/src/sdk/index.ts`), which decides the lag for Candidate C.
- Whether a resumed claude session keeps its original `--model`/`--effort` when the flags are omitted, or needs them repeated (affects the rendered resume command).
- Exact time-delta distribution for claude between `attempt.startedAt` and the first `user` record across many attempts (one sample: 4.7 s); a wider window increases collision with brains started in the same cwd at the same time (three otto-tangent sessions share one cwd today).

## Sources

- /Users/julianotto/.tangent/trees/harnesses.md
- /Users/julianotto/.tangent/trees/README.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-goal-launch-environments.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-worker-context-handover.md
- /Users/julianotto/.tangent/trees/otto/tangent/goal-a-better-view-over-my-work-past-and-present.md
- /Users/julianotto/.tangent/agent-shell/pipelines/otto/tangent/make-area-brains-easy-to-stop-and-launch-correct.json
- /Users/julianotto/.tangent/agent-shell/pipelines/otto/tangent/finish-and-prove-tangent-around-the-area-brain.json
- /Users/julianotto/.tangent/agent-shell/pipelines/otto/tangent/workers-hand-over-at-300k-and-a-fresh-copy-conti.json
- /Users/julianotto/.tangent/agent-shell/continuations/neara/onboarding/build-the-native-dart-onboarding-walkthrough-pan.json
- /Users/julianotto/.tangent/agent-shell/session-owners/097a6befab971f64e9ad2ca6a1f7159820c118d4593f90205938e93b00371cfb.json
- /Users/julianotto/.tangent/agent-shell/brains/neara/brain.json
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/brain.json
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pane-state.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pane-observer.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/command-provenance.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/agent-context.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/agent-command.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/launch-environment.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pipeline-record.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/goal-detail.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/rationale-dossier.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-brain-domain.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/server.mjs (lines 279-336, 397-411, 766-800, 1135-1155, 1687-1795, 2182-2392, 2592-2605, 2763-2869, 4502-4560, 5450-5515, 6530-6550)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/document-reader-view.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/work-desk-view.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/shell.js (line 1258)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/fixtures/panes/codex-idle.txt
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/fixtures/panes/pi-working.txt
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/spec.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/handover.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/goal.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/agent.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/vault.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/docs/public-api.md
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/docs/architecture.md
- /Users/julianotto/Projects/otto-tangent/packages/agent-runtime/src/agent.ts
- /Users/julianotto/Projects/otto-tangent/packages/usage-core/src/schema/index.ts
- /Users/julianotto/Projects/otto-tangent/packages/usage-providers/src/providers/claude/native/discover.ts
- /Users/julianotto/Projects/otto-tangent/packages/usage-providers/src/providers/codex/native/discover.ts
- /Users/julianotto/Projects/otto-tangent/packages/usage-providers/src/providers/native/load.ts
- /Users/julianotto/Projects/otto-tangent/packages/usage/src/cli/spec.ts
- /Users/julianotto/Projects/otto-tangent/packages/hooks/dist/index.d.ts
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0021-pane-states-and-agent-messages.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0028-worker-context-continuation.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0037-brain-attempt-launch-override.md
- /Users/julianotto/Projects/otto-tangent/docs/architecture/package-boundaries.md
- /Users/julianotto/Projects/otto-tangent/docs/architecture/dependency-graph.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-work-contract/design-record.md (lines 530-560, 696-700, 919)
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-navigation-model/design-record.md (lines 80, 158)
- /Users/julianotto/Projects/otto-tangent/handover.md
- /Users/julianotto/Projects/otto-tangent/CLAUDE.md
- /Users/julianotto/.claude-otto/statusline.sh
- /Users/julianotto/.claude-otto/settings.json
- /Users/julianotto/.claude/settings.json
- /Users/julianotto/.wt/hooks/wt-hook.sh
- /Users/julianotto/.claude-otto/.claude.json (projects[otto-tangent].lastSessionId)
- /Users/julianotto/.claude-otto/projects/-Users-julianotto-Projects-otto-tangent/6ff94760-26da-4499-bc23-93ed62fcac0d.jsonl
- /Users/julianotto/.claude-otto/projects/-Users-julianotto-Projects-otto-tangent/e684f2dc-6999-4e3c-9176-2e1837853624.jsonl
- /Users/julianotto/.codex/sessions/2026/08/27/rollout-2026-08-27T06-29-24-01a03fc3-6116-7582-9f3b-d05813c55509.jsonl
- /Users/julianotto/.codex/sessions/2026/08/27/rollout-2026-08-27T06-29-24-01a03fc3-61c2-79c2-944c-79952a42d8d0.jsonl
- /Users/julianotto/.codex/history.jsonl
- /Users/julianotto/.pi/agent/sessions/--Users-julianotto-Projects-delivery--/2026-08-27T01-19-39-441Z_01a040cd-1db1-77a6-b3d2-cf64311f1d7d.jsonl
- /Users/julianotto/.local/bin/codex-gw
- /Users/julianotto/.local/bin/claude-gw
- /Users/julianotto/.local/bin/opencode-gw
- /Users/julianotto/.local/share/uv/tools/neara-harness/lib/python3.14/site-packages/neara_harness/harnesses/claudecode.py
- /Users/julianotto/.local/share/uv/tools/neara-harness/lib/python3.14/site-packages/neara_harness/harnesses/codex.py
- /Users/julianotto/.local/share/uv/tools/neara-harness/lib/python3.14/site-packages/neara_harness/harnesses/pi.py
- /Users/julianotto/.config/neara-harness/claudecode/settings.json
- CLI help: claude --help, codex --help, codex resume --help, pi --help, opencode --help, agy --help
- tangent usage sessions list . --scope all --json; tangent usage sessions get latest --json; tangent usage status .
- tmux list-sessions / show-options / capture-pane on live sessions (2026-08-27)
- lsof on pane pids 54593, 44283, 75895 and children

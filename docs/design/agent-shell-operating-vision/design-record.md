# Agent Shell operating vision: design record

Date: 2026-08-27. Status: agreed with Julian on 2026-08-27 evening (two rounds of answers, recorded in `user-intent.md`). Implementation runs in the order of section 8.

Source of intent: `user-intent.md` beside this file. This record builds on `../agent-shell-work-contract/design-record.md` and `../agent-shell-navigation-model/design-record.md`. It does not repeat them.

Evidence: seven code investigations, one adversarial critique, and eight refutation reviews ran on 2026-08-27 against checkout `488cc0b`, the live server's `deployedCommit`. Line numbers refer to that commit. Facts are marked Observed, Decision, Assumption, or Unknown. The investigation and refutation texts are in `evidence/`.

## 1. Operating philosophy

Julian's words, 2026-08-27 evening:

> The operating philosophy is that tangent provides cli commands for brains to organise workers. That is it. Everything is basically md and agents and a few helpers from tangent cli. The model is less strict and more here are notes we pass around to agents.

> All interactions go through the brain. I can't start an agent without the brain. Workers only have two interactions with tangent: 1) receiving their initial prompt from brain 2) sending messages to brain. Brain should mostly do tangent stuff. Sometimes planning and research. Almost all facts for brain should be stored in md. Default harness, model etc is the one exception because I want to change that manually myself.

Every decision below is measured against those sentences. Two earlier drafts of this record were stricter and had more parts. Section 7 lists what was cut and why.

## 2. Problem contract

### The root problem

Seven things block Julian from driving Agent Shell fast and trusting it without reading:

1. Starting work takes two surfaces and a typed harness. Workers can be started around the brain.
2. Agents talk through four verbs with three names. Workers know eight Tangent commands.
3. Repeatable work has no readable definition. Triggers live in a git-ignored JSON file. No agent knows they exist.
4. No record ties a Goal attempt to the harness conversation. Nothing can resume a dead conversation.
5. Skills live only at home level. No Area carries how-to knowledge a brain can hand to a worker.
6. Area resources (repository, worktree, branch) are prose lines with three parsers. Workers fall back to the vault folder silently: 224 of 716 started steps (31%) did.
7. A brain decides when Julian is asked to check work. One brain filed 53 Tests in three days. Nothing notifies him.

### Constraints that stay

- Keyboard first, one owner per key (ADR-0038). One command registry.
- The vault is canonical for intent. Runtime JSON is canonical for orchestration. Tmux is canonical for live processes.
- A brain lends its own harness to the workers it starts (ADR-0035, Julian's choice).
- Every session Agent Shell creates carries the instance marker (ADR-0036). Only `session-ownership.mjs` kills sessions.
- Agent-shell imports nothing from Usage. No provider hook installation.
- Names use Julian's words. No invented jargon.

### Non-goals

- New record types, approval objects, a second brain model, automatic brain restart, token budgets.
- Any way for Julian or a worker to start an agent without the brain.
- A first-class concept for skills or processes beyond a Markdown file with a name prefix.

### Success conditions

1. From Work, `a` on an Area, a sentence, `⌘↵` reaches the brain. The brain creates the Goal and starts the worker in the Area's repository.
2. A worker's opening prompt names one Tangent command. The server refuses every other Tangent command from a worker session.
3. `tangent process list` and the Area page show every repeatable piece of work with its schedule in words, next run, and last run.
4. `tangent goal show <slug>` prints the resume command per attempt. The Goal reader offers Resume on the attempt row.
5. The brain prompt shows the Area's resources and skills.
6. A worker start with no folder is refused with the line to add. The attempt records its folder.
7. When Julian flagged a Goal, the brain's `goal done` turns into `Check it` and one macOS notification.

## 3. The model

Three actors, two lines of contact.

**Julian talks to the brain.** In Work, `a` on an Area opens a message to that Area's brain. If no brain runs, one starts with the message. `x` on a Goal row marks it done, won't do, parked, or `verify`. Restart on the brain row restarts it. Enter on a brain or worker row attaches to its session.

**The brain talks to Tangent and to its workers.** Tangent commands for brains: `tangent goal create --start`, `goal append`, `goal done|wont-do|park`, `goal list|show`, `send <session>`, `vault commit`, `process list|show`, `area show`. Its prompt lists the Area's resources, skills, processes, open Goals, unread notes, and the plan Document. Everything else it needs is Markdown in the Area folder. The default harness, model, and effort come from the Area note block Julian edits in the UI.

**A worker talks to the brain only.** It receives its opening prompt. It sends `tangent send brain "<note>"`, `--done`, or `--blocked` for a real dependency. Nothing else. The opening prompt says so, and the server refuses other Tangent commands from a worker session.

**Tangent talks to the brain with notes.** A worker sent `--done`. A process is due. Julian sent a message. Julian answered a question. Notes wait in the brain's inbox when the brain is not running.

**Tangent talks to Julian twice.** One macOS notification when a Goal he flagged is ready to check. A small mark in Work when a brain has a question.

## 4. Current system, by theme

All items are Observed. Full detail with candidates and counterexamples is in `evidence/`.

### 4.1 Starting a Goal

- `tangent goal create` needs `--area`, `--title`, `--done-when` (`goal.ts:59-95`). `tangent goal start <slug>` without `--launch` from a non-brain caller returns 400 (`server.mjs:2640-2648`). The browser fills the Area default silently (`goal-launch-view.js:393-396`).
- The New Goal form (`a`) has three required text fields and opens the Launch Editor next (`shell-event-bindings.js:2004-2032`). Describe work already routes a sentence to the brain and resumes an inactive one (`server.mjs:6703-6713`, `4349`).
- A worker report never closes the Goal. Only a designated review under `completionPolicy: "review-pass"` does (`area-brain-domain.mjs:411-418`).
- Every create, start, and report writes a durable notice to `brains/<area>/inbox.json` (`server.mjs:4231-4262`).

### 4.2 Agent communication

- `tangent handover` and `tangent goal handover` post one route. Effects: assignment status, `revision++`, receipt, inbox notice (`server.mjs:3162-3270`). Plain text makes the assignment `waiting` with an `untyped-evidence` report (`worker-handover-production-path-http.test.mjs:172-190`).
- `tangent brain handover` swaps generations and can refuse with 429 pacing (`server.mjs:5076-5122`). The 90-minute reminder is at `server.mjs:5432`. otto/tangent is at generation 324.
- `tangent agent send` stores to `message-queue.json` or an inbox notice (`server.mjs:6290-6311`). 99 agent-to-brain plain messages in 11 days were coordination.
- Workers are taught, across `~/.agents/AGENTS.md` and the prompts: `goal create|own|release|handover|append`, `document comments|resolve`, `idea add`, `vault commit`, `agent list|send`, `process list|start`. The server identifies a session's kind through tmux options (`@tangent_kind goal|brain|process|trigger`) and `commandActor` (`command-provenance.mjs:6-19`).
- `tangent send` is a free top-level noun.

### 4.3 Repeatable work

- Only ADR-0030 triggers exist: `.processes.json` with `every`, `probe`, `instructions`, `cwd`. Two Areas carry one each. Git-ignored. No command creates one.
- The root `tangent trigger check` runs from a LaunchAgent every minute. Trigger workers are retained REPLs; the speedrun trigger ran once and blocked itself twice (`triggers.ts:282-283`). Both triggers fake a calendar and depend on a `cwd`.
- `tangent process` means servers and watchers. The README still describes deleted `recur-<slug>.md` routines.

### 4.4 Harness conversations

- No record holds a provider session id or resume command. One tmux name serves five attempts.
- Claude: `--resume <id>`, `--session-id <uuid>`. Codex: `codex resume <uuid>`, rollouts keyed by time with `cwd` inside, a second `guardian` rollout per launch. Pi: `--session-id <id>`, `--session <path|id>`, sessions keyed by cwd.
- `withDefaultModel` (`agent-command.mjs:2-7`) already appends a flag to claude launches at prime time. Context fill is parsed for claude and pi and hidden below 300k on the desk.

### 4.5 Skills

- Global skills in `~/.agents/skills`, symlinked into every harness home. Claude Code loads `.claude/skills/` from the cwd up to the git root; Codex and pi load `.agents/skills/`. Bound repositories carry project skills (3 in otto-tangent, 11 in delivery).
- A file named `skill-<slug>.md` beside the Area note is already a Document and a valid `--source` (`server.mjs:658-675`, `1246-1260`). The brain prompt has no skills section. Budget 6,900 characters.

### 4.6 Area resources and folders

- `areaDirectory(area)` (`server.mjs:466-471`) reads only the exact Area note's `- Repository:` or `- Worktree:` line. Two more parsers exist (`programs.mjs:44-59`, `triggers.ts:272`). No `Branch:` line is read anywhere.
- Worker: `dir = workingDirectory || areaDirectory(area) || path.join(TREES_ROOT, area)` (`server.mjs:2339`). Brain: the same (`:4804`).
- Only 5 of 29 Area notes bind a folder. Two lines fail to parse (`speedrun.md`, `pgande.md`). `otto/dnd/testing` and `otto/dnd/players` ran 20 steps in vault folders. 13 of 16 brains already start in a vault Area folder.
- Ten test files start Goals against temporary vaults that bind nothing and expect 200 (`evidence/refutations.md`, worker-cwd).

### 4.7 Checking work and brain questions

- Only a live brain can create a Request (`server.mjs:6099-6101`). Every Request mechanism is keyed to a `brain.json`. otto/tangent: 53 Tests in three days, none with an effect, none open.
- Goal statuses: `open|done|dropped|parked` writable plus `active` (`goal-lifecycle.mjs:1`). Both reconcilers skip only `done|dropped|parked` (`server.mjs:1510`, `2454`). Work already uses the word "ready" for a startable Goal.
- No OS notification exists. `terminal-notifier` 2.0.0 is installed and registered, with `-group`, `-remove`, `-open`. Deep links exist for `?view=`, `?area=`, `?document=`.
- Brain questions show as a count on the Area header and the `r` review modal (`work-desk-view.js:822-873`).

## 5. Decisions

Julian's answers are marked (Julian).

### 5.1 Area resources and folders

**D1. Resources are codified in the Area note (Julian).** `## Resources` holds `- Repository: <path>`, `- Worktree: <path>`, `- Branch: <name>`. One parser reads them. It tolerates backticks and stops at ` (`. `resolveWorkFolder(area)` walks parents, nearest first, and returns the first `Worktree` or `Repository` that exists. Programs use the same parser. `tangent area show` prints the three lines. The brain prompt shows them.

**D2. A worker start with no folder is refused.** Before any record: `goal <slug>: <area> and its parent Areas bind no repository. Add "- Repository: <path>" under ## Resources in <note>, or pass --path.` A document-only Area declares its own vault folder, `- Repository: ~/.tangent/trees/<area>`. That line does not inherit. The ten test fixtures gain a `- Repository:` line.

**D3. The attempt records its folder.** `cwd` and `cwdSource: step | area:<area>` on the attempt, `@tangent_cwd` on the session, a `## Working directory` section in the worker prompt, and a folder beside the harness in the start output.

**D4. Brains start in their Area folder in the vault (Julian).** `spawnBrainSession` uses `path.join(TREES_ROOT, record.area)` always. The brain prompt keeps `Repository:` from `resolveWorkFolder` and the instruction-file references. The loss: no native loading of the repository's `CLAUDE.md` and project skills. D20 lists project skills by name.

### 5.2 Worker contract

**D5. Workers have one command (Julian).** `tangent send brain "<note>" [--done | --blocked]`. Plain text is a note on the attempt and a message to the brain, with no status change. `--done` marks the assignment finished. `--blocked` names a real dependency and marks it waiting. Each send writes the note into the brain inbox. The opening prompt ends with the exact command. `~/.agents/AGENTS.md` keeps the worker section to that one command.

**D6. The server refuses other Tangent commands from a worker session.** Goal, document, idea, vault, process, and area mutations from a session whose `@tangent_kind` is `goal` return 403 `workers only send. Use: tangent send brain "<note>"`. Reads (`goal show`, `area show`) stay allowed because a worker may need to read its Goal.

**D7. Old verbs alias for one release.** `tangent handover`, `tangent goal handover`, and `tangent agent send` keep working and print a hint. The untyped-evidence status change goes. Reminder texts and `~/.agents/AGENTS.md` change in the same commit. The worker prompt shrinks to: Goal, `## Done when`, sources, working directory, the brain's instruction, and the one command. It keeps the one sentence that says where design documents go.

### 5.3 Brain contract

**D8. Everything starts through the brain (Julian).** `a` on an Area in Work opens a message to that Area's brain (today's Describe work path, `describeWorkToBrain`, with a plain composer). `⌘↵` sends it. If no brain runs, one starts with the message as its founding instruction. The New Goal form, the Launch Editor on the create path, and `tangent goal create` for non-brain callers go. `tangent goal create --area <a> --title "<t>" [--done-when "<d>"] --start [--launch <ref>] [--path <dir>] [--verify] [--instruction "<i>"]` is the brain's command: it creates the Goal and starts the worker in one call. Done condition optional (the title). Harness: the brain names one, else its own is lent (ADR-0035). The refusal for an omitted launch from a brain goes.

**D9. The brain marks Goals done (Julian).** No automatic closure. When a worker sends `--done`, the brain reads the note and runs `tangent goal done <slug>`, or appends a review worker first. `completionPolicy`, `designatedReview`, and the review-only closure rule go. The Goal `x` menu for Julian is unchanged.

**D10. No brain handover, no rotation (Julian).** `tangent brain handover`, pacing, the 429 refusal, the 90-minute reminder, and `wakeFromPaceText` go. A brain runs until Julian restarts it with the Restart he has (ADR-0037 picker). The brain row always shows the context fill.

**D11. The Area note is the brain's system prompt (Julian).** Each Area folder has `AGENTS.md` and `CLAUDE.md` as symlinks to its main note. The vault root has an `AGENTS.md` that says how to be a brain: what Tangent is, the role, the commands, where information lives. Harnesses read this chain from the Area folder up to the root on their own. Tangent generates no prompt. Brain start opens the harness in the Area folder and types Julian's message. Resources, links, branches, and commands are free-form text under Knowledge, because an Area is not one repository. The brain passes `--path` when it starts a worker. The `- Repository:` lines of D1 stay as an optional shortcut. Tangent never writes into an Area note: the machine-written `## Goals` list and `- Idea:` lines go, and Goals are only the `goal-<slug>.md` files in the Area folder, ordered by status and creation time.

### 5.4 Checking work and brain questions

**D12. Julian flags what he checks (Julian).** Goal frontmatter gains `verify: yes`. He sets it with `x` on the row or by saying so in his message to the brain, which passes `--verify`. Tangent never sets it.

**D13. `goal done` on a flagged Goal becomes `Check it`.** When a brain runs `tangent goal done` on a Goal with `verify: yes`, the status becomes `verify` (shown `Check it`) and `session` is cleared. The brain's done note is written into the Goal's State section. `goalStatusChange` refuses `done` on a flagged Goal from a brain or worker session. Julian's own `x` Done marks it `done`. `WRITABLE_GOAL_STATUSES` excludes `verify`. Both reconcilers skip it. The README allowlist and status list gain it. The word `ready` is not used.

**D14. One notification.** `julian-notify.mjs` sends one macOS notification when a Goal enters `verify`: `terminal-notifier -group goal:<file> -title "<Area>" -message "<Goal title>. Check it?" -open "http://127.0.0.1:4321/?goal=<file>"`. Never `-ignoreDnD`. Removed when the Goal leaves `verify`. `verifyNotifiedAt` on the queue record makes it once per entry. `?goal=` is a new query entry point beside `?document=`.

**D15. Brain questions do not notify (Julian).** They stay a small mark on the Area header. Brains cannot create `kind: test`; the prompt says `Julian flags what he checks.` Other Request kinds are unchanged.

### 5.5 Repeatable work

**D16. A process is `<area>/process-<slug>.md`.** Frontmatter: `type: process`, `status: active|paused`, and either `schedule:` (calendar words) or `when:` (a shell probe) with `every:`. Optional `launch:`, `path:`, `verify:`. The body is what the brain gives the worker. An agent writes it like any note. No define command. The brain prompt lists processes with their next run.

**D17. When due, Tangent tells the brain.** The server's scheduler lane checks every 10 s. When a process is due, it writes one note to the brain inbox: `Process <slug> is due. Start it with: tangent goal create --area <area> --title "<title>" --start --instruction-file <process file> [--path ...] [--verify]`. Missed slots coalesce to the latest. It skips while the last Goal from that process is open. If no brain runs, the note waits and Work shows the process as `Due, brain not running`. No retained REPL, no direct worker start.

**D18. The server is the scheduler.** Run state lives in `~/.tangent/agent-shell/processes/<area>/<slug>.json`. The root `tangent trigger` runtime and its LaunchAgent retire. The two triggers are rewritten by hand as process files with their `cwd` as `path:` and their `- Agent:` line as `launch:`. The retained speedrun session is ended by name. ADR-0030 is amended.

**D19. `tangent process` means Julian's repeatable work (Julian).** Servers and watchers become `tangent service`. Old spellings work for one release. Files that change: `server.mjs:1738`, `shell.ts:35,76`, `src/cli/index.ts:205-206`, `workspace/AGENTS.md:16,27`, `packages/agent-shell/docs/public-api.md:10`, `docs/index.md:8`, `~/.agents/AGENTS.md`, README lines 69 to 77, the otto/dnd checkpoint design, and the ontology Document's Process definition. Read-only view: a `Processes` section at the top of the Area page and `tangent process list|show|pause|resume|check`.

### 5.6 Skills

**D20. A skill is `<area>/skill-<slug>.md` (Julian).** An ordinary Document. Its frontmatter has `name:` and `description:` like a harness skill. `tangent area show` lists every skill on the Area route, root to leaf, as `- <name>: <description> (<abs path>)`. The root `AGENTS.md` tells brains to run it. The section also names the bound repository's own project skills. The brain hands a skill to a worker with `--source <vault-file>` or by naming the path in the instruction.

ADR-0045 supersedes this file convention. Tangent still reads these Documents for compatibility.

### 5.7 Resume

**D21. `harnesses.md` says how to resume.** `tangent.harnesses.v2` adds per harness `resume` (for example `{command} --resume {id}`), `sessionIdArg` (for example `--session-id {id}`), and `transcripts`. A harness without `resume` has no Resume verb. `saveRegistry` and `validateHarnessRegistry` keep the fields. The Document's "never rewrites" sentence names the two flags Tangent appends.

**D22. The attempt records the conversation.** For claude and pi, Tangent appends `sessionIdArg` with a fresh uuid at prime time, from the attempt, and stores `providerSession: { provider, id }` before the session exists. For codex, the rollout is looked up by folder and start time when asked. If two match, both are shown. The attempt also records the last context fill seen while live.

**D23. Resume is a verb on the attempt row.** Live: attach. Dead: `r` opens a new owned tmux session of kind `resume` in the attempt's `cwd` and types the rendered command without submitting. Works on finished Goals because the session is not bound to the Goal. `tangent goal show` prints the command per attempt. The fill shows on every row whenever readable.

### 5.8 Under the hood

**D24. One delivery engine.** Notes to a brain that is not live wait in its inbox (at-least-once). Messages to a live session go through `message-queue.json` (durable until shown). The in-memory notice set goes. Implementation detail.

## 6. Evidence that shaped the decisions

- 224 of 716 steps started in the vault folder silently. `otto/dnd/testing` did so under a bound parent. One parser, inherited, refusing (D1, D2).
- 13 of 16 brains already start in a vault Area folder. The brain cwd becomes constant (D4).
- Workers are taught nine Tangent commands across AGENTS.md and prompts. One command, refused otherwise (D5, D6).
- 99 agent-to-brain plain messages in 11 days were coordination. Plain text changes no status (D5).
- otto/tangent reached generation 324. The 2026-08-25 incident produced 170 generations in four hours. No swap lever (D10).
- Describe work already routes a sentence to the brain and resumes an inactive one. `a` reuses it (D8).
- 53 Tests in three days, none with an effect. Julian decides what he checks (D12).
- Four Areas hold open Goals and no brain record. The check state lives on the Goal file, not a Request store (D13).
- Work already says "ready" for a startable Goal (D13).
- The speedrun trigger ran once and blocked itself twice. Notes to the brain replace retained REPLs (D17).
- `.processes.json` is git-ignored on purpose. Julian asked to read his processes (D16).
- Codex writes a guardian rollout 200 ms after the real one. Assigned ids where possible, both candidates shown otherwise (D22).
- `~/.claude-otto/skills` drifted from `~/.claude/skills` in August. Skills have one file (D20).
- Workers run in `~/Projects/delivery` and worktrees that cannot see the vault. Paths in prompts reach them (D20).

## 7. What the earlier drafts had, and why it was cut

| Earlier draft | Why it was cut | Now |
|---|---|---|
| A quick Goal Julian or a process could start without the brain, with a `default` harness word on the wire | Julian: everything goes through the brain. | D8, D17 |
| Tangent closes Goals by rule (`completionPolicy`, designated review, policy-specific notes) | Julian: the brain marks Goals done. | D9 |
| `tangent checkpoint` and server-owned brain rotation on fill, timer, or Restart | Julian restarts brains himself. | D10 |
| Typed JSON reports, then `--report` | Three flags say the same thing. | D5 |
| A server-created Test Request with a `goal-done` effect, `goalRevision` hashing, a request store keyed to the queue | The Goal file is the whole ask. | D13, D14 |
| Workers keep `vault commit`, `goal own`, `handover` and more | Julian: workers only send. The brain commits. | D5, D6 |
| A process fire creates and starts a Goal directly, with `dedupe` options and an `origin` record | Everything through the brain: the fire is a note. | D17 |
| `tangent process define`, `tangent skill define`, `type: skill` | No first-class concepts. Agents write notes. | D16, D20 |
| Generated per-role command lines, delivery policies, codex tie-breakers, two-phase resume records | Implementation detail or unnecessary. | D11, D22, D23, D24 |

## 8. Rollout order

Each slice ships alone and is tested without a live harness (`AGENT_SHELL_TEST_NO_LAUNCH=1`).

1. **Area resources and folders.** D1 to D4. Vault README revision: the resources rule, `verify` in the allowlist and status list, `process-` and `skill-` files. The `recur-` rule is removed and "no CLI, no schemas" is corrected.
2. **Worker contract.** D5 to D7. The small opening prompt. `tangent send` with three flags. Aliases. The 403 for other commands. AGENTS.md worker section.
3. **Brain contract.** D8 to D15. `a` sends to the brain. Handover and pacing removed. `goal done` on a flagged Goal, `verify` status, notification, `?goal=`. Brain prompt rebuilt from Markdown. AGENTS.md brain section. One short ADR pointing here.
4. **Resume.** D21 to D23.
5. **Processes.** D16 to D19. Trigger runtime retired. `tangent service` rename. ADR-0030 amendment.
6. **Skills.** D20.
7. **Under the hood.** D24, when convenient.

## 9. Risks, assumptions, and unknowns

**Assumptions.**
- Notification Center filters `terminal-notifier` per Focus mode. One manual test settles it.
- `claude --resume <id>` finds a session from any folder. Pi resolves inside its cwd-keyed folder, so the command uses the path form.
- Pi accepts a Tangent-chosen uuid in `--session-id`. Claude refuses a reused id, so the uuid is per attempt.

**Risks.**
- A brain that fills its context and is never restarted degrades until Julian notices the fill. Codex has no readable fill.
- A due process waits for a brain. An Area with no running brain never fires. Work shows it as due.
- A worker that needs to commit vault files cannot. The brain commits after reading the note. If that proves slow, `--done` can stage the worker's vault files for the brain.
- The brain prompt budget (6,900 characters) now carries resources, skills, and processes. Drops show in `## Omissions`.
- The two rewritten triggers change behaviour: calendar time, and a brain in the loop.
- The otto/tangent brain loses native loading of the checkout's `CLAUDE.md` and project skills.

**Unknowns.**
- Whether Julian runs Tangent on a second Mac. Process files carry `path` values.
- Whether `Agent Shell.app` or a browser tab is the daily surface (affects `-open` versus `-activate`).
- agy and opencode session ids. No Resume until `harnesses.md` declares their fields.

## 10. Sources

Investigation outputs (`evidence/`): `quick-goal.md`, `send-not-handover.md`, `processes.md`, `harness-resume.md`, `area-skills.md`, `worker-cwd.md`, `requests.md`, `critique.md`, `refutations.md`, `memos-2026-08-27.txt`.

Repository: `packages/agent-shell/app/server.mjs`, `area-brain-domain.mjs`, `pipeline-record.mjs`, `brain-requests.mjs`, `brain-inbox.mjs`, `message-delivery.mjs`, `agent-command.mjs`, `command-provenance.mjs`, `launch-environment.mjs`, `launch-catalog.mjs`, `programs.mjs`, `goal-lifecycle.mjs`, `pane-state.mjs`, `public/goal-launch-view.js`, `public/work-desk-view.js`, `public/area-work-core.js`, `public/shell-state.js`, `src/cli/{spec.ts,index.ts,commands/*.ts}`, `src/cli/triggers.ts`, `src/cli/processes.ts`, `packages/agent-runtime/src/notify.ts`, `packages/governance/src/index.ts:128-150`.

Decisions: ADR-0022 to ADR-0039. Designs: `../agent-shell-work-contract/`, `../agent-shell-navigation-model/`, vault `otto/tangent/design-define-tangent-s-ontology.md`.

Machine: `~/.tangent/trees/README.md`, `harnesses.md`, Area notes, `.processes.json` files, `~/.tangent/agent-shell/{pipelines,brains,triggers}`, `~/.agents/AGENTS.md`, harness `--help` output, vendor docs for Claude Code (fetched 2026-08-27).

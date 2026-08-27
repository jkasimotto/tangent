# quick-goal (record section 6.1, decisions Q1-Q3)
Verdict: stands-with-corrections

## Findings
**Correction 1. `launchSource: "area-work-default"` is collapsed to `"explicit"` by three existing normalizers the record does not list.**
- `packages/agent-shell/app/pipeline-record.mjs:509`: `launchSource: step.launchSource === "brain-default" ? "brain-default" : "explicit"` runs inside `newPipeline`, so the value Q2 says the server "records" is rewritten to `explicit` before the queue is written.
- `packages/agent-shell/app/server.mjs:2730` (`materializeStepLaunches` disclosure rows) and `server.mjs:2753` (`discloseAssignmentLaunch`) do the same two-value mapping.
- `packages/agent-shell/app/pipeline-record.test.mjs:197-202` pins this: "an unknown source falls back to the caller's own choice". That test breaks or must change.
- Record text at line 305 ("discloses `launchSource: "area-work-default"`, and records it") and rollout slice 1 at line 454 name only the ADR-0035 amendment. Add these three sites and the test to slice 1.

**Correction 2. `completionPolicy: "report"` contradicts ADR-0034 and the record lists no ADR-0034 amendment.**
- `docs/decisions/ADR-0034:38`: "A routine Goal closes after a `passed` review with complete criteria." Line 66: the 2026-08-27 amendment "does not supersede ... review-based automatic closure."
- `area-brain-domain.mjs:411-418`: `closeGoal` is true only for `review-result` on a `designatedReview` assignment under `completionPolicy === "review-pass"`. A worker `implementation-result` closing a Goal is a new closure rule.
- The investigation (`findings/quick-goal.md`, Candidate C, Touches) named "ADR-0034 amendment (worker-report closure only for a policy Julian chose at creation)". The record dropped it: line 27 cites ADR-0034 as a constraint, lines 305 and 454 amend only ADR-0035, slice 2 (line 455) lists no ADR. Add the ADR-0034 amendment to slice 2.

**Correction 3. "Write done and the milestone as today" (6.7 V2, which Q1 defers to) would write a false review note for a quick Goal.**
- `server.mjs:3227-3230`: the only `closeGoal` branch calls `cascadeGoalDone(record.goal, byFile, { note: "It passed its planned review." })` and commits `"update: <area> goal <slug> done after planned review"`. Both strings are hard-coded to review closure. A quick Goal closed by an implementation report has no review. The closure branch needs a policy-specific note and commit message. Not listed anywhere in the record.

**Note 4. The worker prompt tells a quick worker the opposite of Q3's closure rule.**
- `server.mjs:1762`: with no live brain the prompt says "If a real decision needs Julian, ask him here; this legacy pipeline waits." Line 1767: "Free text alone records evidence but cannot advance or close the Goal." Under `completionPolicy: "report"` a complete report closes the Goal, so `pipelineStepPrompt` needs a policy-aware line. The record mentions `pipelineStepPrompt` only for skills (K2, line 372). The investigation listed it under Candidate C; the record dropped it.

**Note 5. The Area Work default can be a command preset with no harness id.**
- `public/goal-launch-view.js:229-231` and `395-396` handle `preset.command` when the default has no `harness`. The `/api/goals/quick` response shape in 5.3 (`launch: { ref, source }`) and Q2's "resolves the Area Work default" assume a harness ref. `materializeStepLaunches` accepts `command` steps, so the mechanism works, but the disclosure row must handle `launch: null` (server.mjs:2728). Minor.

**Note 6. Two rules for one field.** Q1 makes the done condition optional "in the quick path" only. `createSimple` (server.mjs:6966-6979) and `create` (6981-7009) keep the 400, and the form's "Create only" button (`goal-launch-view.js:38-76`) presumably keeps requiring it. The record does not say which rule the form's non-start submit follows. Design choice, but state it.

**Checked and confirmed as stated:**
- `createGoalSet` at `server.mjs:1329-1351` and `startPipeline` at `server.mjs:2872-2903` exist with the described shapes. `startPipeline` calls `goalsByFile()` which rereads the tree (2527-2533, no cache), so a composite handler can call the two back to back.
- Omitted launch refusal: `missingStepLaunches` (server.mjs:2640-2648) and the pin at `brain-worker-launch-http.test.mjs:293-299` (`step 1 has no --launch`). Q2 keeps this refusal, so the test survives unchanged. ADR-0035:21 "Tangent still supplies no harness from ... an Area note" is the sentence that needs the one-line amendment the record already names.
- Browser silent default fill: `goal-launch-view.js:216-233` and `382-398`, as the record says.
- Q3 "never wakes a brain": `routeBrainNotice` (server.mjs:4231-4262) stores the notice and either logs `kept` or queues to a live brain. Only `describeWorkToBrain` (4349), the `/api/brains/message` path (4441), and the recovery sweep (5404, dead-session recovery only) call `startBrain` with `resume: true`. Completion does not. Consistent.
- Julian's words (`user-intent.md:11`): "when it's done, maybe it can send the message to the brain." Q3 matches "maybe".
- `Preparing validation` claim at `work-desk-view.js:1256-1260` confirmed (`goalRunEnded`).
- Vault README has no rule requiring a done condition distinct from the title. The ontology Document calls `done_when` a "proof boundary"; Q1 correctly flags the title-as-done-condition as Julian's decision (section 7 item 1).
- Candidate B (client composite) is simpler in code but has no server call site for processes (slice 6) and brains. The rejection reason holds.

## STE
none in the decision text of 6.1 (lines 296-307) or section 7 item 1 (line 418). No em dashes, no semicolons, no "should". Every sentence is under 25 words; the paragraphs are long but each sentence is short.

---

# send (record section 6.2, decisions S1-S4)
Verdict: stands-with-corrections

## Findings
**1. Server-owned rotation has no idle precondition and decouples the checkpoint from the swap (correction, S2 and 5.5).**
Today the brain chooses the moment: the 90-minute text is a reminder ("At the next natural pause, write the plan status and run tangent brain handover", `packages/agent-shell/app/server.mjs:5432`), and `handoverBrainUnlocked` writes the checkpoint in the same transaction as the swap (`recordHandover` at `server.mjs:5095`, which sets `record.checkpoint` from the handover text, `app/brain-record.mjs:178-184`). `retireBrainHandoverSource` (`server.mjs:4636-4671`) kills the source with no check of its pane state, because the caller was idle by construction. Under S2 the trigger moves to a timer, a fill threshold, or Restart, and the checkpoint is whatever the brain last sent. The new generation is primed from `record.checkpoint`, which normalizes to the latest generation's handover when absent (`brain-record.mjs:84`). Failure scenario: a codex brain in the middle of dispatching a pipeline at minute 90 is killed mid-turn, and generation N+1 starts from a checkpoint written by generation N-2. Record text at `design-record.md:322` ("Tangent rotates brains (5.5)") and `:287` names three triggers and the "nothing to do" exemption only. It must add: rotation waits for the composer to be empty (the server already classifies this, `app/pane-observer.mjs:40`), and what happens when `record.checkpoint.sourceAttemptId` is not the current attempt (refuse, or rotate with a stale-checkpoint note in the prompt). Section 12's `--rotate` fallback covers the opposite problem.

**2. S1 "Untyped evidence stops changing assignment status" breaks a listed production test and leaves a consequence unstated (correction).**
`app/worker-handover-production-path-http.test.mjs:172-190` pins the untyped path: `receipt.reportType === "untyped-evidence"`, `receipt.queue.result === "evidence-only"`, `steps[0].status === "waiting"`, `currentAssignmentId` set. Neither 6.2 nor 5.4 lists it. More important is the runtime consequence: a worker that follows `~/.agents/AGENTS.md:36` (`tangent goal handover "<facts>"`, no `--report`) and then exits leaves the assignment `active` until `stepGoneFromSnapshot` marks it `stopped` with `runtime-stopped: "The worker session ended without a handover."` (`server.mjs:4045-4049`) and the brain receives the "stopped without a handover ... Julian's recovery start" notice (`server.mjs:4095`). Today that worker gets `waiting` with durable evidence on `step.reports[]`. The record must state whether plain text from the current attempt still appends to `step.reports[]` and the attempt (no status change, no `revision++`), or is a notice only. "Plain text is a message only" (`design-record.md:320`) reads as the second, which turns every plain-text finish into a recovery event.

**3. No ADR named for supersession (correction).**
S2 retires ADR-0024 line 23 (self-handover) and the 2026-08-26 pacing amendment (ADR-0024 line 9). S3 retires ADR-0039's "no logical recipient" and "only generic messages are durable" clauses. S1 retires ADR-0034 line 32's two-verb wording and ADR-0029's "Workers use `tangent handover`". Section 6.1 names the ADR-0035 amendment explicitly (`design-record.md:305`); 6.2 and the 5.4 "Brain rotation" bullet (`:278`) name none. Section 13 lists the ADRs only as sources.

**4. `send brain` from an unknown sender has no Area (note).**
`commandActor` returns "unknown sender" with no Area for a session Tangent does not know (`app/command-provenance.mjs:6-19`). The API in 5.3 (`design-record.md:219`) has `from?`. The record should say `brain` is refused with a line naming the Area-path form when the caller has no Area.

**5. Generated verb lines need a role filter (note, S4).**
`app/brain-command-reference.mjs:18` already excludes `handover` from `BRAIN_COMMAND_NOUNS` because it is the worker's verb. With one `send` noun, the generated line must omit `--report` for brains and `checkpoint` for workers, or a brain learns a worker-only form. The record says "one bounded line per verb it may use" without saying how "may" is decided.

**6. Simpler design check (note).**
Candidate C alone (one CLI verb, server unchanged) meets Julian's quoted words ("we can all just make it send") equally well. Server-owned rotation comes from the record's own Rule 2 symmetry with ADR-0034, not from the memo. Section 7 item 5 correctly puts that to Julian. No refutation.

**Confirmed claims.** `tangent send` and `tangent checkpoint` are free root nouns (`src/cli/index.ts:68-78`). `noticesOnTheirWay` exists (`server.mjs:4204`). Pacing's "acted" test is keyed on route path (`server.mjs:7149`) and its only refusal is the handover 429 (`:5084-5087`), so removing self-handover removes the cause. `parseContextFill` exists for the fill trigger (`app/pane-state.mjs:204`). `codex queue --thread <THREAD> --message <TEXT>` exists locally, `--thread` takes "Session UUID or exact session name". `brain-command-reference.mjs` is uncalled in app code. 99 agent-to-brain generic deliveries claim matches the evidence file.

## STE
- Line 313 (table row A): `tangent send brain|me|<session>; the recipient decides the effect.` uses a semicolon. Fix: split into two cells or two sentences.
- Line 322 (S3): "Codex sessions may use `codex queue --thread` as the transport when the harness id is `codex` (Assumption: it delivers into a busy session, to be tested once)." is 27 words. Fix: "Codex sessions may use `codex queue --thread` as the transport when the harness id is `codex`. Assumption: it delivers into a busy session. One test settles it."
- No "should" and no em dash in 6.2.

---

# processes (record section 6.3, decisions P1-P5)
Verdict: stands-with-corrections

## Findings
The core direction (committed `process-<slug>.md`, server scheduler, Goal via the quick route, slot dedupe) survives. The repository facts cited in 3.3 and 6.3 all checked out. Five corrections and two notes.

**1. Correction. P4 cites the wrong authority for `service`, and P4 contradicts the ontology Document without saying so.**
- Record 6.3 P4: "`service` is already the Operation mode name in ADR-0033". `docs/decisions/ADR-0033-area-brain-operating-model.md` never contains the word `service` (grep, zero hits; line 23 says only "Programs project as Area Operations with one mode"). The mode names `service | scheduled | on-demand` exist only in code: `packages/agent-shell/app/area-brain-domain.mjs:426` and its test `area-brain-domain.test.mjs:234`. Cite the code, not the ADR.
- The vault ontology Document the record names as a constraint (section 1, line 26) fixes the opposite meaning: `~/.tangent/trees/otto/tangent/design-define-tangent-s-ontology.md:75` "**Process** | A named long-running command", and `:109` "This model uses **Process** only for the Program variant." `design-record-tangent-around-the-area-brain.md:350` adds "Process: a runtime instance of an Operation. It is an internal term." P4 reverses that definition. The record must say the ontology Document is amended, or the rename violates a vault decision it lists as binding.

**2. Correction. The rename touches callers the record does not list.** Section 5.4 names "AGENTS.md, README lines 69 to 77, and the otto/dnd checkpoint design". Also hard-coded:
- `packages/agent-shell/app/server.mjs:1738` worker prompt text "check `tangent process list` before starting a server or watcher" (every worker lineage is primed with it).
- `packages/agent-shell/src/cli/commands/shell.ts:35` and `:76` error and help text ("start it first (tangent process list)").
- `packages/agent-shell/app/workspace/AGENTS.md:16`, `docs/index.md:8`, `packages/agent-shell/docs/public-api.md:10`, `docs/design/prepared-review-requests/design-record.md:104`, `src/cli/index.ts:205-206` usage text.
- `~/.claude/polez` has zero `tangent process` hits (risk line 476 can drop that tree). `~/.tangent/trees` has only `README.md:76` in Markdown.
- Tests that read `type: "trigger"` or the trigger runtime and change or die with P3: `test/triggers.test.mjs`, `test/processes.test.mjs`, `packages/agent-shell/app/{programs,area-brain-domain,operation-events,program-controls-coordinator,program-stop-controls,refresh-lifecycle,action-telemetry,work-table-ui,keyboard-ownership-ui,launch-keyboard-ui}.test.mjs`. Rollout slice 6 lists none.
- Server-side trigger consumers beyond `programs.mjs`: `server.mjs:6443-6448` (`runLocalTangent(["trigger", ...])` for check/acknowledge/stop), `public/program-view.js`, `public/shell.js`, `public/work-desk-view.js`, `public/shell-coordinator.js`, `public/shell-event-bindings.js`, `public/refresh-lifecycle.js`, `action-telemetry.mjs`, `public/prompt-bestiary.js`.

**3. Correction. P1 declares no directory field, but both real triggers depend on one, and the record elsewhere assumes it.**
- P1 frontmatter: `type`, `status`, `schedule` or `when`+`every`, `launch`, `verify`, `dedupe`. No `path` or `cwd`. Yet section 11 (line 485) says "Committed process files carry `cwd` paths", and the quick route (line 215) accepts `path?`.
- Rebase trigger: `~/.tangent/trees/neara/pgande/.processes.json` sets `cwd: /Users/julianotto/git-worktrees/polez/pgande-staging-rebase`, and the instructions (`pgande-staging-rebase-instructions.md:3`) say "You run in the worktree at ...". The Area note binds `$POLEZ` and `$DELIVERY` (`pgande.md:41-42`, written as "- Repository `$POLEZ` — dart", which the exact parser at `programs.mjs:55` does not match). Under Rule 5 with no `path`, the migrated worker starts in the Area binding or is refused. Migration silently changes where the rebase runs.
- Speedrun trigger: cwd is the vault Area folder; `speedrun.md:31` binds a delivery Worktree. Under Rule 5 the migrated worker moves to that worktree. The instructions `cd` to absolute paths so it may work, but the record's risk list (line 479) names only the calendar-time change, not the directory change.
- Fix: add `path:` to P1 (mapped to the quick route's `path`) or state that migration rewrites both triggers to rely on Area bindings.

**4. Correction. P1 leaves the harness undefined when `launch:` is omitted.** `launch:` is "optional". The quick route requires `launch: "default" | {...}` (line 215) and ADR-0035 refuses a silent default. Today both triggers get their harness from the `- Agent:` line (`triggers.ts:302-314`, `speedrun.md:30`), which the critique says must retire. The record must say either that `launch:` defaults to the word `default` (disclosed as the Area default) or that `tangent process define` refuses without it. Migration of speedrun needs the `- Agent:` command copied into `launch:`.

**5. Correction. P3 reverses two ADR-0030 clauses without recording an amendment.** ADR-0030 line 9 and 19: the root runtime exists because "Agent Shell may be closed" and "Agent Shell ... is not the scheduler"; line 17: trigger workers "do not create Goals or require an Area brain". P2 and P3 reverse all three. Section 5.5 gives the KeepAlive argument (confirmed: `~/Library/LaunchAgents/com.tangent.agent-shell.plist:25-28` RunAtLoad + KeepAlive) but no ADR amendment appears in rollout slice 6 or section 13. Also the `when:` probe has no stated executor: today it runs as `zsh -lic` with a 60 s timeout in the trigger cwd (`triggers.ts:168`); the record retires that runtime and names no shell, cwd, or timeout for server-run probes.

**6. Note. Run-state store is new.** `~/.tangent/agent-shell/` holds `triggers/` but no `processes/`; 5.2's `processes/<area>/<slug>.json` is a new directory and the migration must move `triggers/state.json` keys into it, which 5.4 says ("keeps their state keys") but does not name the target.

**7. Note. Simpler alternative considered and rejected correctly.** Candidate B (extend `.processes.json`) is genuinely blocked by `~/.tangent/trees/.gitignore:8` and `README.md:78`; Julian's words "read them" need history. No simpler design meets the words. Candidate A is right.

Line-level claims confirmed: `.gitignore:8`; `README.md:21,69-80,92`; `triggers.ts:126-131` (interval relative to last check), `:282-283` (still-active check), `:302-314` (`- Agent:` fallback); `programs.mjs:190`; `area-brain-domain.mjs:426`; `runtime-scheduler.mjs` (41 lines, serial named lanes, 1 s tick) and `server.mjs:2155-2163` (10 s Operation lane); `server.mjs:6439-6448`.

## STE
none in the 6.3 decision text (P1-P5, lines 333-341): no sentence over 25 words, no "should", no semicolons, no em dashes.

---

# harness-resume (record section 6.4, decisions R1-R4)
Verdict: stands-with-corrections

## Findings
## Blocking

**1. R4 names a function that refuses the exact case R4 gives it.** `packages/agent-shell/app/server.mjs:3831` `replaceGoalAttemptUnlocked` calls `inspectCurrentGoalAttemptTarget` (`:3873`), which at `:3590-3592` returns `{ code: "source-absent" }` when `attempt.session` is not in the live tmux list. A dead session therefore yields 409 before any spawn. Three more contract breaks on the same path:
- `:3875` `launchCatalog.requested({ choice: options.launch })` only resolves a registry `{harness, model, effort}` choice (`launch-catalog.mjs:106-116`); the rendered string `claude-otto --model claude-opus-5 --resume <uuid>` is a raw command, which ADR-0037 (`:33`, `:45`) declares invalid for this route.
- `:3891` spawns with `launch: true`, and `primeGoalSession` (`:2192-2195`) presses Enter when `launch` is true. The record's "typed and never submitted" is the opposite of what the function does.
- `:2340-2342` (spawnGoalSession) primes with `prompt: stepPrompt`, the full `pipelineStepPrompt`. A resumed conversation would receive the whole assignment prompt again once the harness boots.
- `:3834` and `:2274` refuse Goals in `done | dropped | parked`. Julian's words are "always resume". A finished Goal's attempt could never be resumed through this path.
Text to fix in record: "Dead session: `POST /api/goals/resume` starts a new attempt through `replaceGoalAttemptUnlocked` in the recorded `cwd` with the rendered resume command, typed and never submitted." Either R4 declares a sibling operation (same two-phase `goal-attempt-replacement.v1` record, same `createOwnedTmuxSession`, but no source fence, `launch: false`, no armed prompt, a `resume` launch kind exempt from ADR-0037, and no closed-Goal refusal), or it states which of these five checks it amends and which test it changes.

## Corrections

**2. R2's codex discovery rule is ambiguous in practice, and the record dropped the tie-breaker the finding supplied.** Real rollouts on 2026-08-26/27: of the last 15 `thread_source: "user"` rollouts, 4 start within 60 s of another user rollout in the same cwd (`/Users/julianotto/Projects/otto-tangent`). All were Tangent starts: worker s2 `01:20:01.846Z`, brain g323 `01:20:23.647Z`, worker `01:21:03.805Z`; worker `21:33:22.473Z` and brain g322 `21:33:57.080Z`; brain g324 `02:20:03.102Z` and worker s2 `02:20:45.974Z` (`~/.tangent/agent-shell/pipelines/otto/tangent/*.json`, `brains/otto/tangent/brain.json`). Rule 5 moving brains to the vault removes brain-vs-worker collisions but not worker-vs-worker in one repo. Also one rollout timestamp precedes `attempt.startedAt` (`01:20:01.842Z` vs `.846Z`), so a window that starts at `startedAt` misses it. Fix: window `[startedAt - 2 s, startedAt + 60 s]`, and when more than one candidate remains, match the first user message against the typed prompt (whitespace-normalised) or hold the attempt as `candidates` without writing `providerSession`, as `findings/harness-resume.md` Candidate A already says.

**3. R3 "at `endedAt`, `lastFill`" cannot be read at that moment.** The reconciler sets `attempt.endedAt` at `server.mjs:4046-4048` only after `byName.get(step.session)` is undefined (`:4036`); `session.context` comes from the live pane sample and is gone. `lastFill` must be written on every reconcile pass while the session is live, then frozen. The record text should say "the last live sample" not "at `endedAt`".

**4. R1's `transcripts` glob "with `{cwdKey}`" does not describe codex.** Codex rollouts live under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (section 3.4 of the record says so); the cwd is inside the file (`session_meta.payload.cwd`), not in the path. Either `transcripts` for codex has no `{cwdKey}` and discovery reads the first line, or the field needs a second shape. State it.

**5. R2 puts the uuid append in `composeLaunchCommand` "the renamed `withDefaultModel`", but that function has callers outside worker starts.** `gateway.mjs:379` and `server.mjs:7198` compose `chatCommand` once at boot for the terminal transport; `server.mjs:6688` returns the composed command in an API payload; `server.mjs:4888` types the brain launch. A one-time-composed `chatCommand` with a fixed uuid would reuse the same `--session-id` for every chat session (claude refuses a second session with an id already used, an Assumption the record should list). Fix: append the uuid per prime (`:2191`, `:2204`, `:4888`) from the attempt, not inside the shared composer.

## Notes

- ADR-0035 `:25` promises the disclosed `command` is the exact launch. Appending `--session-id <uuid>` at prime time makes the disclosed command differ from the typed one (already true for `--model default`). Record should say the disclosure row carries the final string or that the uuid is disclosed separately.
- The vault Document text "Tangent never rewrites these strings" (`~/.tangent/trees/harnesses.md:5`) needs editing with the v2 block; R1 does not list that edit.
- `launch-catalog.mjs:122-131` `saveRegistry` writes `version: 1` and `validateHarnessRegistry` does not know the new fields; the browser registry editor would strip them on save. Not listed in R1's touches.
- Section 3.4 claims verified: `agent-command.mjs:2-7`, `work-desk-view.js:1176-1179`, 285 queue records with zero `"cwd"`, claude/pi/codex flags from `--help`, codex two-rollout behaviour.

## STE
none in the 6.4 decision text (lines 344-360): no sentence over 25 words, no "should", no semicolons, no em dashes.

---

# area-skills (K1-K3, record section 6.5)
Verdict: stands-with-corrections

## Findings
## Verified claims (all hold at 488cc0b)

- Brain cwd: `packages/agent-shell/app/server.mjs:4804` `const directory = (await areaDirectory(record.area)) ?? path.join(TREES_ROOT, record.area);`, tmux `-c directory` at `:4839`. `areaDirectory` `:466-471` reads only the exact Area note (no ancestor walk).
- Dot-directory skipping: `server.mjs:536,1040,1303` all test `entry.name.startsWith(".")`; `TREE_SKIP` at `:520`. Confirmed.
- Documents by prefix: `readAreaDocuments` `server.mjs:658-675` indexes every `.md` beside the note except `goal-`/`outcome-` as `kind: "document"`; `sourceDocuments` `:1246-1260` caps at 8 and requires `kind === "document"`. So `skill-<slug>.md` is a valid `--source` with zero index changes. Confirmed.
- Hardcoded skill path in the worker prompt: `server.mjs:1731` and `:1739` both name `~/.agents/skills/simple-english/SKILL.md`. Confirmed.
- `inheritedInstructionFiles` `area-brain-domain.mjs:50-72` reads `AGENTS.md`/`CLAUDE.md` from root to working folder; `BRAIN_STRUCTURAL_LIMIT = 6_900` at `:11`; brain prompt required sections at `server.mjs:4592` exclude any Skills section, so a `## Skills` section is optional and drops silently under pressure (record lists this risk in section 11). Confirmed.
- Vault has no `AGENTS.md`/`CLAUDE.md`/`SKILL.md`; no symlinks tracked; `~/.pi/agent/trust.json` is `{"/Users/julianotto/Projects": true}`; `~/.codex/config.toml` trusts `~/.tangent/trees`; `~/.claude-otto/.claude.json` has one vault project entry. Confirmed.
- Drift incident: `~/.tangent/trees/otto/tangent/tangent.md:33`. Confirmed.
- No test asserts the brain session's cwd equals the bound repository (`describe-work-brain-http.test.mjs:120` asserts only the prompt line `Repository: none bound`; `launch-environment-http.test.mjs:202,216` assert worker cwd, not brain cwd). K3 breaks no listed test.

## Corrections

**1. (correction) Overstated premise in 6.5 A and K3: "Fails for the Areas Julian uses most: their brains run in bound repositories" / "his brains for otto/tangent and otto/dnd run inside product repositories today".**
Evidence: only five Area notes bind a directory (`otto/tangent/tangent.md:99`, `otto/dnd/dnd.md:37`, `neara/pgande/standards/standards.md:32`, `neara/pgande/speedrun/speedrun.md:31`, `neara/hackathon/live-edit/live-edit.md:55`). Of 16 `brain.json` records, 13 belong to Areas with no binding (neara, neara/portland, neara/enums, neara/hackathon, neara/pgande, neara/onboarding, otto/launcher, otto/dotfiles, autodesign, megabranch, viz-input, embedded-js), so those brains already start in the vault Area folder where Candidate A's native discovery would work. Also no brain is live now: otto/tangent is `inactive`, otto/dnd is `stopped` (`~/.tangent/agent-shell/brains/*/brain.json`), so "run ... today" describes the resolver, not a running process. The decisive argument for B is the worker side (portland's five live workers run in `~/Projects/delivery` and `~/git-worktrees/delivery/*`, per `tmux pane_current_path`), which the record does state. Rewrite the "why it lost" cell to lead with workers in foreign repositories and to say "brains of the two Areas that bind a product repository" instead of "the Areas Julian uses most".

**2. (correction) K1 contradicts Julian's words and the record does not say so.** `user-intent.md:27`: "And we don't need any like first class concept for this, I don't think." K1 adds a new Document type (`type: skill`), a new CLI noun (`tangent skill define`), and a new frontmatter value that violates README:21 ("and no others"). The record's own precedent line (`design-record.md:155`) says Documents are "typed by name" via prefix, which makes `type: skill` redundant with `skill-<slug>.md`. Simpler design that meets the memo equally well: `skill-<slug>.md` stays `type: document`, is written the way every other Document is written today (editor or agent plus `tangent vault commit`), and only the prompt builders learn the prefix. Section 8 lists "Julian's own mechanism" as rejected but never records the "no first class concept" sentence. Add it to section 7 item 3 so Julian sees the departure, or drop `type: skill` and `tangent skill define` from slice 7.

**3. (correction) K3 creates a loss the record does not list: brains of repo-bound Areas lose the repository's harness-native project skills and CLAUDE.md content.** `~/Projects/otto-tangent/.claude/skills/` holds `verify-app`, `mark-agent-mistake`, `setup-tangent-eval`; `~/Projects/delivery/.claude/skills/` holds 11 work skills (`commit-hygiene`, `verify`, `dim-*`, `fibery`, ...). Today a brain started in that repo sees them natively (Claude Code loads `.claude/skills` and `CLAUDE.md` from cwd to git root; Codex/pi walk `.agents/skills`). After W4/K3 the brain gets `Instruction source: <file> sha256:<hash>` references only (`server.mjs:4555`) and no reference to project skills at all. The record says "Paths in prompts reach both. Symlinks reach neither." but only vault skills get paths; repo project skills get nothing. Failure scenario: the neara/pgande/standards brain (pi-code, bound to `~/Projects/delivery`) can no longer name `$commit-hygiene` to itself or verify its existence before telling a worker to use it. Mitigation to record: list the bound repository's `.claude/skills/*` and `.agents/skills/*` names in the same `## Skills` section, or use `--add-dir` for Claude harnesses. Either way, section 6.5 or 6.6 must list this consequence.

**4. (note) Pi trust change in W4 is only needed for Candidate A, not B.** Critique item 11 and pi-mono README:298: pi prompts only when the project folder contains `.agents/skills`. With B, no vault Area holds `.agents/skills`, and the speedrun trigger already runs pi-code in `~/.tangent/trees/neara/pgande/speedrun` without a prompt. 6.5 A's "Pi prompts for trust" is correct as an argument against A; W4's `trust.json` change is then precautionary, and the record should say so rather than list it as required.

**5. (note) K2 `--skill` on `tangent goal start` is new surface; today `--source` exists only on `goal create` (`src/cli/commands/goal.ts:15,78`), and `goal start`/`append` accept `step, launch, path, continue-from, kind` only (`goal.ts:105-107,166`). The record's API section shows `--skill` "(later, skill chains)" at line 244 but K2 says workers get named skills "through `--source` or `--skill`" now. State which slice adds `--skill` to `start`/`append`, and that the `sourceDocuments` cap of 8 (`server.mjs:1249`) bounds both.

**6. (note) Live proof that vault frontmatter already departs from README:21**: `type: design` (35 files), `type: impl` (5), `type: plan` (5), `type: design-record` (2) exist under `~/.tangent/trees`. So `type: skill` follows practice, not the rule; the README revision in 5.4 line 279 covers it. No ADR is violated by K1-K3; ADR-0033 ("A bound repository owns code-agent instructions") is honoured by W4 keeping `Repository:` and instruction hashes from `workRepository(area)`.

## STE
- Line 372 (Decision K2), 26 words: "`brainPrompt` gains an optional bounded `## Skills` section: one line per skill, `- <title>: <abs path> (<Area>)`, capped at 12 with an omission line." Fix: split after "section." then "Each line is `- <title>: <abs path> (<Area>)`. The list stops at 12 and adds an omission line."
- Line 374 (Decision K3), 26 words: "The reason is concrete: his brains for `otto/tangent` and `otto/dnd` run inside product repositories today, and his workers run in repositories that cannot see the vault." Fix: "The reason is concrete. Brains of `otto/tangent` and `otto/dnd` start inside product repositories. Workers run in repositories that cannot see the vault."
- No "should", semicolons, or em dashes found in 6.5 or section 7 items 2 and 3.

---

# worker-cwd (record section 6.6, decisions W1-W4)
Verdict: stands-with-corrections

## Findings
**Confirmed line-level claims (no defect).** `areaDirectory` at `packages/agent-shell/app/server.mjs:466-471` reads only the exact Area note through `areaResource` (`:449-458`), no ancestor walk. Worker fallback `workingDirectory || areaDirectory(area) || path.join(TREES_ROOT, area)` at `:2339`, tmux `-c dir` at `:2342`. Brain `:4804` same rule. Describe work `:2237`, sidebar refusal `:510-511`. `noteResource` regex at `area-agent-command.mjs:8-13`, `areaAncestors` at `:2-6`. `programDirectory` at `programs.mjs:44-59`. ADR-0035 "121 of 634" at `docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md:11`. `~/.pi/agent/trust.json` holds only `"/Users/julianotto/Projects": true`. Vault `README.md:75` ("the process uses that node's Repository or Worktree") is consistent with W1 inheritance. Checkout is `488cc0b` as the record says.

**Correction 1 (correction): a third parser exists that W1 does not name.** `src/cli/triggers.ts:272` has `^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$` and `:88-92` derive a trigger's cwd from it when `.processes.json` has no `cwd`. Section 3.6 says "A second parser exists for Programs" and W1 says "Programs use the same function". The record's section 13 lists `src/cli/triggers.ts` as a touched file, but 6.6 leaves the trigger runtime on its own copy. Either W1 names `triggers.ts:272` as a caller of `workRepository`, or 6.3 must state that the root trigger runtime is retired before W1 lands. Text to fix: 3.6 "A second parser exists for Programs (`programs.mjs:44-59`)" and W1 "Programs use the same function."

**Correction 2 (correction): W2 breaks ten test files the record does not list.** These files POST `/api/goals/start` against temp vaults whose Area notes bind no `Repository:` line and expect 200: `action-telemetry.test.mjs` (2 starts), `armed-prompt-restart.test.mjs`, `attempt-replacement-restart-http.test.mjs`, `brain-notices.test.mjs` (7), `focus-shell-live-step-ui.test.mjs`, `focus-shell-pipeline-ui.test.mjs` (3), `launch-routes.test.mjs`, `mermaid-diagram.test.mjs`, `work-contract-server-http.test.mjs` (2), `worker-handover-production-path-http.test.mjs`. Under W2 each gets the new 409 before any record. The findings file names only three tests to update. The record's touch list should name these fixtures (add `- Repository: <tmp>` to each fixture note) or the refusal slice will look like a regression across the suite.

**Correction 3 (correction): W4 removes native harness loading for the one brain that has it today.** The `otto/tangent` brain runs in `~/Projects/otto-tangent` now and Claude Code loads that repo's `CLAUDE.md` (the mandatory `tangent search` rule) and `.claude/skills/{verify-app,setup-tangent-eval,mark-agent-mistake}` from cwd (record line 115 states this discovery rule). With cwd `~/.tangent/trees/otto/tangent` none of that loads. `brainPrompt` only lists `Instruction source: <file> sha256:<hash>` lines (`server.mjs:4552-4556`) and tells the brain to "read ... inherited repository instructions" (`:4585`); it does not paste them, and `.claude/skills` are not listed at all (K2 lists vault skills only). `tangent search` also indexes by cwd, so the brain would search the vault, not the checkout. Section 6.6 D1 names the neara `git status` hazard but not this loss on the Tangent side. The record should state it and say how the brain gets the repo instructions (paste, or a `## Skills` line per repo skill), or accept the loss in words.

**Correction 4 (correction): the `- Repository: ~/.tangent/trees` opt-in is inherited, which defeats the W2 refusal for every descendant.** W1 walks `areaAncestors`. If `neara` (97 vault steps today) binds the vault root on purpose, then `neara/portland`, `neara/pgande/*`, and every future child starts silently in `~/.tangent/trees` whenever a step omits `--path`. That is the same silent fallback W2 exists to remove, now with a wider directory (the vault root, not the Area folder). Fix options: make the vault opt-in non-inheritable, or make the opt-in the Area folder (`~/.tangent/trees/<area>`, today's fallback location, keeps Claude transcript keys per Area), and have the audit command flag inherited vault bindings. Text to fix: W2 last sentence.

**Note: W4 "inheritedInstructionFiles reads that path, not the cwd" is already true.** `server.mjs:4508-4509` passes `areaDirectory(area)` to `inheritedInstructionFiles(repository, repository)`; cwd was never used. The only change W4 needs there is the swap to `workRepository`. The sentence reads as if it fixes a bug.

**Note: `.claude/settings.local.json` litter in vault folders.** `~/.config/git/ignore:6` ignores `**/.claude/settings.local.json` globally, so the litter the record cites (3.6 side effects) never enters vault git. W4 makes vault-folder brains the norm, so `.claude/` dirs will appear in every Area folder with a Claude brain. Harmless for git, but the record should say so rather than cite the litter as a harm of the old fallback while keeping brains there.

**Note: `cwdSource` placement.** ADR-0035's `launchSource` sits on the step/assignment (`pipeline-record.mjs:509`), and `path` sits on the assignment too. W3 puts `cwd`/`cwdSource` on the attempt. That is defensible (a replacement attempt can use a different `--path`) but is asymmetric with `launchSource`; state the reason in one sentence.

**Not refuted.** No ADR forbids brains in the vault (ADR-0024:19, ADR-0033:16 say nothing about brain cwd). Memo 2's words ("brains should open in the tangent repository", skills "within each area") are met by D2 as well as D1, and the critique's point that discovery stops at the git root of the cwd makes D2 the only reading that serves the purpose. No simpler design meets "never silently in the vault" without the refusal.

## STE
- Line 386 (W2): "A worker start with no `--path` and no resolvable binding is refused before any record: `goal <slug>: <area> and its parent Areas bind no repository. Add ...`" is passive ("is refused") and runs past 25 words when the quoted message is counted. Fix: "Tangent refuses a worker start that has no `--path` and no resolvable binding. It writes no record. The message reads: `goal <slug>: ...`."
- Line 393 (W4): "The brain prompt keeps `Repository: <path>` from `workRepository(area)` and `inheritedInstructionFiles` reads that path, not the cwd." Two clauses joined by "and" with two subjects. Fix: split into two sentences.
- Line 61 (Rule 5): "A worker's cwd is the Area's bound repository, an ancestor's, or the step's `--path`." Acceptable length. No fix needed.
- No "should", semicolons, or em dashes in the 6.6 decision text.

---

# requests (record section 6.7, decisions V1-V5)
Verdict: stands-with-corrections

## Findings
## 1. A Verify-flagged Goal in an Area with no brain record produces a Test nobody can see or answer (blocking)

Every Request mechanism is keyed to a `brain.json`, not to the Goal's Area:

- `answerRequest` (`packages/agent-shell/app/server.mjs:6115-6118`): `const brain = await brainOfArea(area); if (!brain) return { status: 404, error: "no brain on <area>" }`. `brainOfArea` (`:5550-5552`) is `readAllBrains(...).find(record => record.area === area)`, exact match, no ancestor walk.
- `executeAuthorizedRequestEffect(effect, brain)` (`:6056-6067`) needs `brain.session` for `vaultCommit` and `recordCommittedCommand`.
- The browser only sees requests through `state.brains` (`server.mjs:5632`, `readAllBrains`), and `closeRequestsForGoals` (`:1571-1584`) walks `readAllBrains` only. So retraction on Goal end (V4) also never runs for such a store.

Live state: `brain.json` exists for 17 Areas (`find ~/.tangent/agent-shell/brains -name brain.json`). Areas with open Goals and no `brain.json`: `neara/pgande/autodesign` (10 open Goals, and `~/.tangent/agent-shell/pipelines/neara/pgande/autodesign/create-dev-and-model-build-scopes-on-pg-e-design.json` has `controllerArea: neara/pgande/autodesign`), `neara/pgande/benchmarking` (6), `neara/pgande/dashboards` (2), `otto/tangent/model` (2). A `verify: yes` Goal there reaches `ready`, the server writes a request into an unread `requests.json`, the notification fires, the click opens the Goal, and Accept returns 404. The Goal is then stuck in `ready` with no path out except finding 2's bypass.

Record text that is incomplete: V2 "create the Test with a `goal-done` effect" names no store and no answering actor for a brainless Area. The record must say the Test lives in the queue's `controllerArea` store or in a Goal-keyed store, and that Accept must not require a brain record (pass a null session to the commit, as the review closure at `:3242` already does with `vaultCommit(..., null)`).

## 2. "Accept is the only path from ready to done" is not enforced anywhere the record lists (correction)

- `goalStatusChange` (`goal-lifecycle.mjs:43-61`) validates only the target status; `done` is accepted from any current status, including `ready`.
- The `edit` route (`server.mjs:7045-7058`) runs `cascadeGoalDone` for `fields.status === "done"` with no verify check. `cascadeGoalDone` (`:1518-1541`) writes `done` whenever `goal.status !== "done"`.
- The `x` menu (`public/work-commands.js:25`, "Choose Done, Won't do, Park, or Reopen") and `tangent goal done` both hit that route.
- `~/.agents/AGENTS.md` tells a brain it "closes Goals under its own plan the same turn a review passes". A brain can therefore `tangent goal done` a Verify-flagged Goal that is still `open` (solo Goal, no queue) or already `ready`, and Julian is never asked.

V2 gates only the pipeline closure branch (`server.mjs:3229-3247`). The record must add: `goalStatusChange` refuses `done` when the Goal carries `verify` unless the caller is the authorized effect, and the AGENTS.md brain rule gains the Verify exception.

## 3. "at the current Goal revision" is not what the effect mechanism checks (correction)

V2 says the Test carries "a `goal-done` effect at the current Goal revision". `effectRevision` is `sha256(JSON.stringify(effect))` (`brain-requests.mjs:84`); `answerBrainRequest` and `beginRequestEffect` (`:165, :188`) compare only that hash. `executeAuthorizedRequestEffect` for `goal-done` (`server.mjs:6059-6067`) reads no Goal revision and calls `cascadeGoalDone` unconditionally. The review closure does compare `goalContentRevision` (`:3233-3234`) but that runs before `ready`, not at Accept. To bind Accept to the Goal revision the effect JSON must include `goalRevision` and the executor must compare it with `goalContentRevision(file)`. The record should state that as new work, not as an existing property.

## 4. "Julian is the only writer" of `verify` is a rule the record itself breaks (correction)

- `POST /api/goals/create` (`server.mjs:6980-6990`) takes `caller` for provenance only; any agent session can pass `--verify`.
- The record's own section 5.3 puts `verify?` on `POST /api/processes/define`, and P1 (line 334) puts `verify:` in the process file that agents define with `tangent process define`. Goals a process creates therefore get `verify` from an agent-written file.
- Brains create Goals from Julian's voice (`describeWorkToBrain`, `server.mjs:4323`), so the brain is the writer there too.

Rewrite V1 to "Julian's word, carried by whoever creates the Goal", or add an enforcement the record does not list.

## 5. `ready` collides with Work's existing "ready" vocabulary (note)

`public/area-work-core.js:17,73,92,123` uses fact kind `ready` for a dependency-free startable Goal, and `public/work-desk-view.js:883` renders "N Goals ready" with that meaning. `work-desk-view.js:1199,1201,1230,1323` uses `kind: "ready"` for rows whose action is "Start agent". A Goal status `ready` meaning "finished, waiting for Julian" reads the opposite way on the same screen. The memory `name-work-in-julians-words` and `explain-decisions-concretely` bind here. Julian's own phrase in the vault is "ready to validate" (`design-record-make-completed-work-directly-testable.md:22`).

## 6. "The reconciler never flips `ready` to `open`" is a requirement, not a fact (note)

Both reconcilers skip only `["done", "dropped", "parked"]`: `server.mjs:1510` (release after worker cleanup) and `:2454` (dead session binding). A `ready` Goal whose `session` line still names the finished worker is flipped to `open` on the next sweep. The `ready` write must clear `session` (as `cascadeGoalDone` does) or both lists must gain `ready`. Section 5.4 states the outcome without naming these two lines.

## 7. Reject leaves the queue `complete` and nothing reopens the Goal today (note)

`answerRequest` with `changes` requires text (`brain-requests.mjs:163`) and notifies the brain (`server.mjs:6155`) but changes no Goal status, and the queue is already `status: "complete"` (`area-brain-domain.mjs:410`). V5's "returns the Goal to `open`" is new server work, and the brain must append assignments before any worker runs again. Fine as a decision, but the record should list it under touches.

## Confirmed as written

- `server.mjs:6099-6101` 403 for non-brain creators. `brain-requests.mjs:7` kinds; `:99` `closurePolicy: "observation-only"` for new Tests. `b577256` is 2026-08-26.
- `goal-lifecycle.mjs:1` writable statuses; `DEFAULT_HIDDEN_GOAL_STATUSES` excludes `ready`; `normalizeGoalStatus` passes `ready` through; `defaultGoalCommands` (`goal-detail.mjs:74-77`) disables Start with "This Goal is ready."
- `completionPolicy` defaults to `"review-pass"` at `pipeline-record.mjs:114,146` and `area-brain-domain.mjs:328`, compared at `:416`; `newPipeline` called at `server.mjs:2893,2914`; no caller passes another value.
- Legacy approve path `server.mjs:6141-6153` is skipped for a request with `closurePolicy: "observation-only"` and answer `authorize`, so the server-created Test does not double-close.
- `shell-state.js:12-16`: `view`, `area`, `document` query params only, no `goal`.
- `terminal-notifier -help`: `-group` ("Old notifications with the same ID will be removed"), `-remove ID`, `-open URL`, `-sender`, `-activate`, `-ignoreDnD` all present.
- ADR-0034:40 "A Goal that needs human judgment uses a revision-bound Question effect" is consistent with V2/V5. ADR-0030:26 deferred native notifications; the record records the reversal.
- Vault README:21 allowlist "and no others"; section 5.4 lists the README revision, so V1 does not violate it silently.
- `work-desk-view.js:1257` already renders `goal.status === "ready"` as "Ready for validation".

## STE
- Line 410 (Decision V4): "It sends at most once per `request.id`, stores `notifiedAt` on the request, removes the notification (`-remove request:<id>`) on answer, dismiss, withdraw, or Goal end, and never passes `-ignoreDnD`." is 27 words. Fix: split after "on the request." into two sentences: "It removes the notification (`-remove request:<id>`) on answer, dismiss, withdraw, or Goal end. It never passes `-ignoreDnD`."
- No "should", semicolons, or em dashes in lines 395-413.

---

# cross-cutting (record section 5 and 10): rollout order and migration plan
Verdict: stands-with-corrections

## Findings
## Confirmed (the plan does not refute)

- No slice leaves unreadable records. `packages/agent-shell/app/pipeline-record.mjs:114` already defaults a missing `completionPolicy` to `"review-pass"` and `:146` writes it at `newPipeline`, so old queues keep today's closure when slice 2 adds `"report"`. `normalizeQueueRecord` (`:71-96`) reads named fields only and ignores unknown ones. `attempt.cwd`, `attempt.providerSession`, `attempt.lastFill`, `queue.origin` are additive.
- The 410 precedent the record cites exists: `server.mjs:3366` (Restart) and `:3396` (Send-on).
- Every cited reminder-text line is correct at `488cc0b`: `5050-5056` `pacedHandoverText`, `5277` `wakeFromPaceText`, `5432` the 90-minute "run tangent brain handover" queue message, `5493-5495` the context "tangent handover" text. The legacy approve path is at `6141-6153` as stated.
- `session-safety.test.mjs:33-36` (`continueWorkerSession|continueWorker:`) and `context-continuation.test.mjs:7-20` (`body.continue` refusal at `pipeline-routes.mjs:28-30`, "any local caller can start a fresh attempt" in `context-handover.mjs:54,61`) are untouched by the plan: Resume runs through `replaceGoalAttemptUnlocked` (`server.mjs:3831`), not a worker continue path, and the record never adds a `continue` option.
- `brain-worker-launch-http.test.mjs:293-299` asserts 400 for an omitted launch; Decision Q2 keeps an omitted launch refused and adds the word `default`, so the test stands.
- Dock badge and `ask-core.js` lints (`governance/src/index.ts:137-142`): nothing in the plan touches `setAppBadge` or imports `ask-core.js`. The record retires `ask-dismissal-core.js`, which ADR-0033:45 already parks for the audit window.
- `cascadeGoalDone` on `row.kind === "test"`: the legacy path at `server.mjs:6143` keys on `request.kind`, not `row.kind`, and the record removes it. V2 closes through the `goal-done` effect at the closure branch, not a row scan.
- "Existing Tests are all closed": `~/.tangent/agent-shell/brains/neara/requests.json` holds 16 Tests, 0 open. No other Area has Tests.
- `com.tangent.triggers.plist` exists in `~/Library/LaunchAgents`; the two trigger entries are the only ones in `~/.tangent/agent-shell/triggers`.

## Corrections

1. **correction, `design-record.md:275-276` and `:453-456`.** The governance lint at `governance/src/index.ts:132` forbids the regex `/accepts its Test.*close|Test approval.*close/i` in `server.mjs`, `pipeline-record.mjs`, `pipeline-routes.mjs`, `commands/goal.ts`, `spec.ts`, and `docs/public-api.md`. Decision V5 text is "Accept ... is the only path from `ready` to `done`", and the CLI spec, public-api.md, and the closure comment in slice 3 will describe that a Test accept closes a flagged Goal. Any such sentence trips the lint. The record says the four named lints and tests are "untouched or named as amended", but section 10 slice 3 and section 5.4 name neither this lint nor the wording constraint. Add: slice 3 either amends the lint (scoped to routine closure) or the record states the wording rule for those six files.

2. **correction, `design-record.md:450-451` and `:457`.** "Each slice is independently shippable and tested" lists no test files for slice 4. Nine existing tests reference the routes, text, or state slice 4 removes (`/api/brains/handover`, `/api/goals/handover`, `brain-pacing`, `noticesOnTheirWay`, `pacedHandoverText`, `wakeFromPaceText`, `handoverOperation`): `brain-pacing.test.mjs`, `brain-notices.test.mjs`, `brain-prompt.test.mjs`, `pipeline-routes.test.mjs`, `worker-handover-production-path-http.test.mjs`, `area-brain-production-path-http.test.mjs`, `work-contract-server-http.test.mjs`, `focus-shell-workflow-http.test.mjs`, `agent-shell-instance-ownership-http.test.mjs`. The one-release route aliases keep the HTTP tests green only if the alias returns the same shape; `brain-pacing.test.mjs` and `brain-notices.test.mjs` test code the record deletes. Name them as amended or deleted in slice 4.

3. **correction, `design-record.md:275` (tangent process rename scope).** The record lists AGENTS.md, README lines 69 to 77, and the otto/dnd design. Also naming `tangent process list|start` in this repo: `packages/agent-shell/app/workspace/AGENTS.md:16,27` (the chat pane's instructions, which also define "Program"), `packages/agent-shell/docs/public-api.md`, `docs/index.md`, `docs/design/prepared-review-requests/design-record.md`. Nothing under `~/.claude/polez` or the skills folders matches, so the "grep those trees" risk in section 11 is smaller than stated and the in-repo list is larger.

4. **note, `design-record.md:274` (trigger migration).** The speedrun trigger record carries `sessionName: trigger-speedrun--speedrun-pgande-7e780adf`, a retained REPL created by the root CLI without the instance marker (ADR-0036, critique item 2). The migration "keeps their state keys" but never says who ends that session. Only `session-ownership.mjs` kills sessions and it does not own this one. State the manual step or the migration leaves an orphan tmux session.

5. **note, `design-record.md:272` and vault README.** The README revision list omits the status list at `~/.tangent/trees/README.md:37` (`open | active | waiting | deferred | done | dropped`), which gains `ready`, and `goal-lifecycle.mjs:1` `WRITABLE_GOAL_STATUSES` (`open, done, dropped, parked`) which must exclude `ready` from the `x` menu while `readAreaGoals` accepts it. The record covers hidden statuses only.

6. **note, `design-record.md:232` (`POST /api/goals/resume`).** Rule 2 says an agent never replaces an agent, but the resume contract carries no caller field and no refusal for a live worker resuming its own attempt. Today's `replace-agent` has the same gap, so this is not new, but the record claims the rule as structural.

7. **note, `design-record.md:171` ("reverses two earlier decisions").** The two decisions are not named. The rule that Work carries no OS-level attention is ADR-0033:45 (no strip, no Dock badge); ADR-0025:19 and ADR-0027:44 describe the badge the lint now forbids. Name them so the reversal is auditable.

No decision reintroduces worker self-continue, a Dock badge, an `ask-core.js` import, or `cascadeGoalDone` on `row.kind === "test"`. The rollout order is sound: slice 1 is a precondition the later slices read, and slices 2, 5, 6, 7 only add fields with defaults.

## STE
- Line 279: "One revision covers: `verify` in the allowlist, `process-` and `skill-` Documents, removal of the `recur-` rule, correction of "no CLI, no schemas", and the directory binding rule." (31 words). Fix: split into a list of five bullet items under "One revision covers:".
- Line 290: "Questions an operator asks and where the answer lives: which harness ran this attempt ... why a process did not fire (run record `lastSlot`, `error`)." (54 words). Fix: make a two-column table, question and record field.
- Line 459: slice 6 sentence (26 words). Fix: break after "server scheduler," into two sentences, or bullet the items.
- No semicolons, em dashes, or "should" in sections 5 and 10.

---


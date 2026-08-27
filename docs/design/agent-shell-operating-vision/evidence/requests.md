# requests

## Observed

## 1. The Request record (durable, brain-authored)

- Store: one JSON file per Area brain, `~/.tangent/agent-shell/brains/<area>/requests.json`, schema `area-brain-requests.v1` (`packages/agent-shell/app/brain-requests.mjs:6`, path at `:24`). Live files inspected: `brains/otto/tangent/requests.json` (77 requests) and `brains/neara/requests.json` (21 requests).
- Kinds: `REQUEST_KINDS = plan | decision | test | approval` (`brain-requests.mjs:7`). Allowed exact effects: `goal-done`, `route-journal` (`:8`, validated at `:11-20`).
- Shape written by `createBrainRequest` (`brain-requests.mjs:62-108`): `{ id (uuid), kind, subject (<=80), question (must end in ?, <=160), proposal (required, <=200), detail (<=300), options[], goal (vault file or null), effect, effectRevision (sha256 of effect), documents[], effectOperation, brainGeneration, ownerRef {type:"brain", area, generation:null}, subjectRef {type:"goal", goal} | {type:"brain", area}, conversationAnchor {area, session, generation}, precedingContext (last 800 chars of the brain pane), status:"open", createdAt, closurePolicy: kind === "test" ? "observation-only" : null, answeredAt, answer, note, response }`.
- Lifecycle functions: `closeGoalRequests` (reason `goal-ended`/`goal-done`/`goal-dropped`, `:120-124`), `closeBrainRequests` (`brain-ended`, `:127-132`), `handoverBrainRequests` (moves open requests to the next generation, `:135-141`), `withdrawBrainRequest` (brain, `:144-151`), `dismissBrainRequest` (Julian, `closedReason:"dismissed"`, `:154-159`), `answerBrainRequest` (`:162-180`): answer must be `reply | authorize | approve | changes` or a legacy option; `reply` and `changes` need text; `authorize` needs the matching `effectRevision`. `beginRequestEffect`/`finishRequestEffect` (`:183-218`) record an idempotent effect operation keyed `request-effect:<id>:<effectRevision>`.
- `brainRequestAnswerNotice` (`:243-257`) is the text the brain receives: `Julian replied: ... for "<subject>".` etc. `openBrainRequests` (`:260`) = status open.
- Observed live data (python over the two files): otto/tangent has 53 `test` requests (21 on 2026-08-24, 28 on 2026-08-25, 4 on 2026-08-26, 0 on 2026-08-27), 52 of 53 carry `goal`; answers `approve` 36, `changes` 8, legacy `pass` 3, `needs-work` 2; median time to answer 0.1 h, max 7.5 h. neara has 16 tests (14 on 08-24, 2 on 08-25), only 9 of 16 carry `goal`, median 0.1 h, max 10.5 h; 3 requests closed `dismissed`, 1 `withdrawn`. Zero requests in either file carry an `effect`, and zero carry `closurePolicy:"observation-only"`: every stored Test predates commit `b577256` (2026-08-26, "implement audited Area brain workflow", which introduced `observation-only`). No request is open right now in either Area.

## 2. HTTP routes and server operations

- Routes (`packages/agent-shell/app/brain-routes.mjs:22-33`): `POST /api/brains/requests` (create), `POST /api/brains/requests/answer`, `POST /api/brains/requests/withdraw`, `POST /api/brains/requests/dismiss`, plus legacy Markdown-row verbs `POST /api/brains/verdict`, `/verdict/undo`, `/reply`, and `GET /api/brains/show`.
- `createRequest` (`server.mjs:6098-6113`): `liveBrainForSession(session)` must resolve or the route returns `403 "only a live brain can create a request"`. So only a live brain can author a Request; the browser and Julian cannot.
- `answerRequest` (`server.mjs:6115-6158`): for `authorize` it runs `beginRequestEffect`, `executeAuthorizedRequestEffect` (`:6059-6083`, `goal-done` -> `cascadeGoalDone` + `vaultCommit` + `recordCommittedCommand`), then `answerBrainRequest`, then `notifyBrain(brain.area, brainRequestAnswerNotice(request))` (`:6155`). Legacy branch `:6141-6153`: a stored Test with `closurePolicy !== "observation-only"` and `answer === "approve"` and a `goal` still closes that Goal ("done by legacy Test Request"). Comment at `:6141-6142`: "New Test Questions are observation-only."
- `dismissRequest` (`:6172-6181`) writes the record then `notifyBrain(area, 'Julian dismissed "<subject>". The Request is closed; do not wait for an answer.')`.
- `closeRequestsForGoals` (`server.mjs:1571-1584`) closes open Requests in every brain store when a Goal ends; called from the done path at `:1539`.
- Brains payload: each brain carries `requests: openBrainRequests(...)` (`server.mjs:5632`) next to legacy `forJulian` rows (`:5631`). The browser reads this from `state.brains` (`public/shell.js:649` hashes `item.requests` for repaint).
- Brain prompt (`server.mjs:4501-4599`, `brainPrompt`): `Questions:` section lists open requests (`:4576`); `"Asking Julian"` section (`:4581-4584`) reads: `A Question always takes a free-text reply. Add an exact effect only for these two, with --effect '{"type":"..."}': goal-done needs "goal", and closes that Goal in this Area when Julian authorizes the exact revision. route-journal needs "area" and "text" ... Anything else is a reply, not a button. Run tangent brain request --help for the exact flags.` `"Execution contract"` (`:4570`): `A designated review closes routine work only at the current Goal revision. Free text never closes a Goal.` No prompt text tells the brain when to file a Test. The previous generation's answered requests are replayed as lines by `answeredRequestLines` (`:4490-4499`).
- Delivery to the brain: `notifyBrain` -> `routeBrainNotice` (`server.mjs:4231-4261`) writes an inbox notice (`brain-inbox.mjs`, schema `area-brain-inbox.v1`, `~/.tangent/agent-shell/brains/<area>/inbox.json`, notices with `sourceId`, `deliveredAt`) and queues into the live brain composer. Memory note `brain-request-mechanics.md`: answers "are delivered only when the session composer is empty, so a brain working through a long turn is deaf".

## 3. CLI

- `tangent brain request` (`packages/agent-shell/src/cli/spec.ts:62-77`): options `--kind plan|decision|test|approval`, `--subject`, `--question` ("The question, ending in ?"), `--proposal` ("The exact transition that Approve applies"), `--detail`, `--option` (repeat), `--goal` ("Goal slug this request is about; approval of a test request closes this Goal"; stale wording, see §4), `--effect` (JSON), `--session`. Implementation `src/cli/commands/brain.ts:51-69`: `requireSession` (tmux), `requireGoal(server, slug).file`, `postJson(server, "/api/brains/requests", ...)`, prints `asked Julian: <id>`.
- `tangent brain withdraw <request-id> [--note]` (`spec.ts:88-96`, `brain.ts:40-48`).
- `tangent brain status` prints `questions: N open` (`brain.ts:121`).
- `tangent goal create` flags (`src/cli/commands/goal.ts:15`, `spec.ts:147-157`): `--area --title --done-when --state --description --source* --subgoal-title* --subgoal-done-when* --own`. No verify or validation flag exists.
- No `tangent notify` command exists (grep over `packages/*/src` for a `notify` CLI spec: none).

## 4. Who decides a Test exists today, and how Goals close

- Only the brain creates Requests (§2). Nothing in code or prompt makes a Test mandatory or forbidden. The brain's own plan taught itself the rule: `plan-tangent.md:119` "create a Goal-linked Test request only after final review passes", `:217` "if satisfied create one kind=test Request linked with --goal", `:300` "ALWAYS pass --goal on a test request". `tangent.md:90` (Area Knowledge idea) records the 2026-08-24 failure where a Test without `--goal` could never close its Goal.
- Since `b577256` (2026-08-26) closure is typed: `submitWorkerReport` (`area-brain-domain.mjs:375-421`) sets `closeGoal` only when `type === "review-result" && assignment.designatedReview && queue.completionPolicy === "review-pass" && verdict === "passed" && report.goalRevision === queue.goalRevision && every criterion passed with evidenceRefs`. `completionPolicy` defaults to `"review-pass"` (`area-brain-domain.mjs:328`, `pipeline-record.mjs:114,146`) and no caller passes any other value (grep over `server.mjs`: none). Server applies closure at `server.mjs:3229-3247`: `cascadeGoalDone(record.goal, byFile, { note: "It passed its planned review." })`, `vaultCommit(... "done after planned review")`, then `notifyBrain(... "its designated typed review passed the current revision and Tangent marked the Goal done.")`. Review prompt text at `server.mjs:1766`: "Only a complete passed report at this revision can close the Goal."
- ADR-0034 (`docs/decisions/ADR-0034-audited-area-brain-workflow.md`): "A routine Goal closes after a `passed` review with complete criteria... Free text never closes a Goal. A Goal that needs human judgment uses a revision-bound Question effect." ADR-0033: "A passing planned review closes routine work." `~/.agents/AGENTS.md`: a brain "closes Goals under its own plan the same turn a review passes and the done condition holds; a finished Goal left waiting is the brain's failure, not a question for Julian".
- A new Test is `closurePolicy:"observation-only"` (`brain-requests.mjs:99`): answering it does nothing to the Goal unless the brain attached `--effect '{"type":"goal-done","goal":...}'`. In production no request has ever carried an effect (§1).
- Opt-in/out per Goal or per Area: none. Goal frontmatter emitted by `renderNewGoal` (`server.mjs:1234`): `type: goal`, `status: open`, `done_when`, `session` (files also carry `waiting_on`); parser reads `fm.done_when || fm.outcome` (`:793`); `editGoalFile` (`:1174-1188`) writes only status, session, title, doneWhen and body sections. The Goal launch editor (`public/goal-launch-view.js:616`) offers Type `Implementation | Review`, Path, Session; harness/model/effort radios (`:554-566`). Per-Area settings that exist: the declared work-default harness (`server.mjs:2615-2631`, `launchCatalog.forArea`, `tangent harness list --area`), `.processes.json` programs, Area note frontmatter limited to `type, status, due, owners, waiting_on` (`~/.tangent/trees/README.md`, Node notes).
- Julian's stated model (vault): `design-record-make-completed-work-directly-testable.md:18-22`: "Julian rejected six semantic request types. He specified one generic ask and two answers: approve or typed requested changes." and his Goal states "not being worked on, being worked on, waiting for input, ready to validate and done". `design-the-for-you-row-shows-only-direct-asks.md:227-228` (Answers 2026-08-22): "Either I need to decide or test something"; bare Reject means "Don't bug me about it now." Goal `goal-park-a-request-now-get-told-later-if-it-still-ma.md` (dropped, "Superseded by the ontology-first investigation") records his wish to park a Request and be told later.

## 5. Browser rendering of Questions (Work view)

- Source of rows: `areaQuestions(path)` (`public/work-desk-view.js:822-826`) = open `brain.requests` of the Area and every child Area. Doc comment `:818-821`: "Only a brain writing an explicit Request makes one... Tangent does not infer an ask from machine state."
- Area header summary `deskAreaSummary` (`:850-865`) appends `N question(s)`; `deskAreaState` (`:868-873`) returns `{kind:"waiting", label:"N questions"}` ranked above `working`; header render `workGroupHeaderRow` (`:1539-1541`) makes the pill a button `data-review-questions` when `summary.questions`, else a plain span. Blockers list puts Questions first with owner `You` (`areaBlockers`, `:836`).
- Command `r` = "Review questions" (`public/work-commands.js:21`, scope area). `openQuestionsReview` (`:1048-1073`): modal kicker `Questions`, title `N from Area brains`, a select of `<area> — <subject>: <question>`, confirm `Open question`; empty state "No open questions. No Area brain needs a reply."
- `openRequest` (`:1000-1045`): modal kicker `Request`, title = subject, copy = native conversation anchor + preceding context + `Proposed transition` + question + detail + effect revision/state; options `Reply to the brain`, `Authorize exact effect: <proposal>` (only if `request.effect`; `Retry exact effect` after a failed operation), `Dismiss this Question`; confirm `Apply response`. Reply posts `/api/brains/requests/answer` with `answer:"reply"` via `sendVerdict` (`:1110-1132`, line id `request:<id>`); dismiss posts `/api/brains/requests/dismiss`.
- Goal card: `goalHasOpenTest` (`:1234-1240`) checks open `kind === "test"` requests (and legacy `forJulian` test rows) by Goal file; `idleGoalState` (`:1256-1259`) shows `Ready for validation` with action `Review` when a Test is open, `Preparing validation` when the run ended with none.
- Refresh: timer every 30 s (`public/refresh-lifecycle.js:108`); no push. `document.title` is only set by the Document reader (`shell.js:825`); no title count, no web `Notification` API use (grep: none).
- ADR-0033 removal enforced: governance lint `packages/governance/src/index.ts:141-144` refuses `attention-queue|>For you<`, `setAppBadge|clearAppBadge|data-enable-dock-badge`, `askFrom(StoppedStep|DialogSession|WaitingOn)`, and `from "./ask-core.js"` in `work-desk-view.js`, `shell.js`, `shell-event-bindings.js`; tests `focus-shell-work-navigation-ui.test.mjs:278-285`, `work-table-ui.test.mjs:224-228`. `ask-core.js` has no importer. `ask-dismissal-core.js` is still imported at HEAD: `public/shell.js:30` (`ASK_DISMISSALS_KEY, readDismissedAskIds`, storage listener at `:1520-1521`) and `public/shell-state.js:2,42` (`dismissedAskIds`).
- Prompt bestiary concept text (`public/prompt-bestiary.js:23`): "Request: A durable question from a Brain to Julian. The Brain that created it. It stays open until Julian answers it."

## 6. Notification mechanisms on this machine

1. `@tangent/agent-runtime/notify` (`packages/agent-runtime/src/notify.ts`): `notify({title, body}, config)` runs `osascript -e 'display notification "<body>" with title "<title>"'` on macOS (`:63-66`), `notify-send` on Linux, or a custom template; config `~/.tangent/notify/config.json` (`:33-36`, file absent on this machine) with `events: {done, needsInput, failed}` (`:14-18`). Repo-wide grep for importers outside tests and docs: none. Dead code documented in `packages/agent-runtime/docs/public-api.md:11`.
2. Dock badge: browser side deleted (ADR-0033, lint above). Native shim survives in `packages/agent-shell/app/native/main.swift:45-57` (injects `navigator.setAppBadge` -> `webkit.messageHandlers.dockBadge`) and `:209-216` (`NSApp.dockTile.badgeLabel`). `~/Applications/Agent Shell.app` exists; `Info.plist` bundle id `dev.otto.agent-shell`, no `CFBundleURLTypes`; `main.swift` contains no `UNUserNotification`/`NSUserNotification`; `dev.otto.agent-shell` is absent from `~/Library/Preferences/com.apple.ncprefs.plist` (it has never registered with Notification Center). Server runs under launchd `com.tangent.agent-shell` (`launchctl list` shows it), installed by `native/install-launch-agent.sh`.
3. Statusline `~/.claude-otto/statusline.sh` (and identical `~/.claude/statusline.sh`): context bar, cost, cwd, plus a red `●N` badge from `~/.tangent/threads-status.json` counts `needsYou + blocked`. That file was last written 2026-08-14 07:32 with all counts 0; Threads were deleted by ADR-0029 (`ADR-0029-remove-threads-and-routines.md`). The badge path is dead. The statusline also writes `~/.wt/sessions/<wt-session>.tokens` for tmux sessions named `wt-*`.
4. Claude Code `Notification` hook (`~/.claude/settings.json:8-16`, matcher `permission_prompt`) -> `~/.wt/hooks/wt-hook.sh:72-78`: `osascript -e "display notification \"$BASENAME needs permission\" with title \"wt\""`. The script exits unless the tmux session is named `wt-*` (`:20`). Tangent sessions are named `<area>-brain-gN` and `<area>-<goal>-sN` (tmux list-sessions), so this hook never fires for Tangent agents. `~/.claude-otto/settings.json` has no hooks.
5. `terminal-notifier` 2.0.0 at `/opt/homebrew/bin/terminal-notifier`, registered in Notification Center as `fr.julienxx.oss.terminal-notifier` (ncprefs). Flags: `-group ID` (replaces older notification with same id), `-remove ID`, `-open URL`, `-execute COMMAND`, `-activate bundle-id`, `-sender`, `-sound`, `-ignoreDnD`. Not referenced anywhere in the repo.
6. `PushNotification` tool (Claude Code, schema loaded): desktop notification in the user's terminal, phone when Remote Control is connected; skipped when the user is active at the terminal; session-scoped, not callable from the Agent Shell server.
7. Brain notices (`brain-inbox.mjs`, `routeBrainNotice`) and the generic queue (ADR-0039, `~/.tangent/agent-shell/message-queue.json`, `agent-message-queue.v1`) are agent-facing only.
8. Triggers (ADR-0030): an `attention` probe result becomes an Operation `problem` only until acknowledged (`area-brain-domain.mjs:427-430`), reaching Work as a problem (ADR-0033). ADR-0030 consequences: "Calendar schedules, native notifications, and event queues require later evidence."
9. Vault design history: `design-record-command-my-attention-from-work.md:30,137` removed "Watch and notification policy" from scope; `design-record-tangent-around-the-area-brain.md:205-212` cites interruption research and concludes "deliberate review instead of ambient prompts", `:661-667` "An open brain question appears in three places only: its Area brain conversation, a quiet `1 question` count on that Area header, the deliberate Questions review mode... The review never appears automatically."; `design-done-goals-timeline.md:34` uses macOS Notification Center as the model of a glance surface.
10. Memory `julian-does-not-use-tangent-ui.md`: "When designing tooling for Julian, never make a web page the load-bearing surface; use vault markdown, skills, OS notifications, statusline."

## 7. macOS Focus

- Observed: macOS 26.6.2 (`sw_vers`). `~/Library/DoNotDisturb/DB/` is TCC-protected from this shell ("Operation not permitted"), so the configured Focus modes and their per-app filters could not be read. `terminal-notifier -help` documents `-ignoreDnD  Send notification even if Do Not Disturb is enabled`, which implies its default delivery is subject to Do Not Disturb/Focus.
- Assumption (not verified locally): notifications posted through Notification Center (osascript `display notification`, attributed to `com.apple.ScriptEditor2` in ncprefs; terminal-notifier under its own bundle) are filtered per app by the active Focus mode; a terminal bell, tmux tab colour (`wt-hook.sh set_tab_color`), or an in-page count are not.

## Gap

- Ontology today: a Request exists because a brain chose to write one (`POST /api/brains/requests` is 403 for anyone but a live brain, `server.mjs:6098-6101`). Julian has no field, flag, command, or UI control that says "I want to verify this Goal" before the work runs. The only opt-in he has is after the fact: dismiss (`/api/brains/requests/dismiss`) or bare Reject.
- Nothing tells the brain when a Test is due. The prompt's `Asking Julian` section (`server.mjs:4581-4584`) explains effects, not occasions; the plan and Area Knowledge carry self-taught rules (`plan-tangent.md:119,217,300`). Result: 53 Tests in three days in otto/tangent and 16 in neara, 7 of neara's without a Goal link, 5 dismissed or withdrawn. Since `b577256` a passed designated review closes the Goal itself (`area-brain-domain.mjs:414-420`, `server.mjs:3229-3247`), so a brain-authored Test is now redundant for routine work and unrequested for everything else; a new Test is `observation-only` and changes nothing when answered unless the brain attached a `goal-done` effect, which no production request has ever carried.
- Delivery: an open Question is a count on the Area header plus the `r` review modal, refreshed by a 30 s poll (`refresh-lifecycle.js:108`). No OS notification is sent by anything in Tangent; the only osascript path in the repo (`agent-runtime/src/notify.ts`) has no importer, the statusline badge reads a file that stopped changing on 2026-08-14, and the wt hook ignores Tangent sessions. Because nothing is sent, nothing respects or violates macOS Focus.
- Consistency with "other notification systems": there is no per-notification identity, no retraction when a Request is withdrawn, dismissed, or closed by `goal-ended`/`brain-ended` (`closeRequestsForGoals`, `transitionBrainRequests`), no click target (Agent Shell has no URL routing: grep for `location.hash|pushState` in `shell.js`, `shell-coordinator.js`, `go-to-core.js` returns nothing; `Info.plist` declares no URL scheme).
- One list: the in-app Questions surface is `requests.json` filtered `status === "open"`; a notification channel would have to read the same record and record its own delivery state there or duplicate the list.
- Julian's words "I will say if I want to validate or verify a feature" invert the ADR-0025/0027/0033 axiom "the actor that knows writes the list, Tangent never invents an item for Julian" into "Julian writes the list of what he verifies; the brain invents nothing". Decision, plan, and approval Requests are untouched by the memo but come from the same brain-driven path.

## Candidates

## (a) Per-Goal verify flag set by Julian; server-created Test; native notification

Mechanism
- Data shape: one Goal frontmatter property, e.g. `verify: julian` (absent = no verification), written by `renderNewGoal` (`server.mjs:1234`) and `editGoalFile` via `withFrontmatterLine` (`:1185-1188`), parsed beside `done_when` (`:793`). Set at creation with `tangent goal create ... --verify`, by a toggle in the Goal launch editor (`goal-launch-view.js:616` metadata row), and by an `x`-style status command on the Goal row for existing Goals. Julian's words on the Goal are already "his word" in the vault rules, so the flag lives with `status`.
- Closure rule: `submitWorkerReport` already gates on `queue.completionPolicy === "review-pass"` (`area-brain-domain.mjs:416`). At queue creation (`newPipeline`, `server.mjs:2893,2914`) derive `completionPolicy: goal.verify ? "julian-verify" : "review-pass"`. On a passed review under `julian-verify`, the server (not the brain) creates the Test with `createBrainRequest(record, { kind:"test", goal, effect:{type:"goal-done", goal}, subject:<Goal title>, question:"Accept it?", proposal:"Mark the Goal done." })` and records the review's `evidenceRefs` in `detail`/`documents`. Authorize runs the existing `executeAuthorizedRequestEffect` (`server.mjs:6059-6067`); Reply with text becomes a `changes-required` style notice to the brain (existing `brainRequestAnswerNotice`).
- Unflagged Goal: nothing changes; review pass closes it as today (`server.mjs:3229-3247`) and no Request exists. Solo Goals without a queue: no review, no closure, no Test; the brain can still close them under its plan (AGENTS.md rule) or Julian marks done.
- Brain: `tangent brain request --kind test` is refused (400) unless the Goal carries `verify`; or `test` is removed from `REQUEST_KINDS` for brains and only the server writes it. The prompt's `Asking Julian` section drops the goal-done sentence for Tests and states "Julian flags what he verifies; you never file a Test."
- Notification: on request creation the server spawns `terminal-notifier -title "<Area> · Verify" -message "<Goal title>: Accept it?" -group "request:<id>" -sender dev.otto.agent-shell -open "http://127.0.0.1:4321/#request/<area>/<id>"` (or `-activate dev.otto.agent-shell` until a route exists). Idempotency: one per `request.id`; store `notifiedAt` and `notifiedRevision` on the request record; a reconcile pass only sends when `status === "open" && !notifiedAt` (and re-sends only when `effectRevision` changed). Retraction: `terminal-notifier -remove "request:<id>"` on answer, withdraw, dismiss, `goal-ended`, `brain-ended`. The in-app count (`areaQuestions`) and the `r` review keep reading the same `requests.json`, so the OS notification and the Questions review are one list by construction; a deep-link route `#request/<area>/<id>` calls `openRequest(area, id)`.
- Focus: delivery through Notification Center inherits macOS Focus filtering for the sender app; never pass `-ignoreDnD`.

Touches: `brain-requests.mjs` (server-side create, notified fields), `server.mjs` (frontmatter, queue policy, closure branch, request creation, notifier, deep link), `goal-command.mjs`/`src/cli/commands/goal.ts`/`spec.ts` (`--verify`), `goal-launch-view.js` (toggle), `work-desk-view.js` (flag shown on card, `openRequest` route), `shell-coordinator.js` (hash route), governance lint (forbid `-ignoreDnD`, forbid brain-authored `kind:"test"`), `~/.tangent/trees/README.md` allowlist, ADR.

Trade-offs: Julian must remember to flag at creation; Goals created by the brain from a voice dump (`describeWorkToBrain`, `server.mjs:4323`) need the brain to carry his "verify" word into `--verify`; per-Goal is exactly his sentence "I will say if I want to validate".

Migration: existing open Tests (none today) close as `withdrawn`; `closurePolicy` stays for legacy records; the `:6141-6153` legacy approve path can be deleted after the audit window (governance already forbids the Markdown variant).

## (b) Area-level default verify policy with per-Goal override

Mechanism: an Area setting `verify: always | never` stored where the Area work-default harness lives (`launchCatalog.forArea`, `tangent harness`-style records, not the Area note whose frontmatter allowlist is closed), plus the per-Goal `verify:` override from (a). Queue policy resolves override, then Area default, then `review-pass`. Same server-created Test, same notification path.

Touches: everything in (a) plus the Area defaults editor (`goal-launch-view.js` default-agents block, `data-default-agents`) and `tangent area` CLI.

Trade-offs: fewer decisions per Goal for Areas Julian always checks (neara/portland reviews) but two places to look to know why a Test appeared; `areaQuestions` counts child Areas on the parent header, so an inherited default must resolve on the exact Area of the Goal, not the nearest brain. Contradicts "I will say if I want" when the default is `always`.

Migration: default `never` everywhere, so behaviour equals (a) until Julian sets an Area.

## (c) Keep brain-authored Requests, gate only delivery

Mechanism: no ontology change. Add a notification policy: Tests notify only when the Goal is flagged (`verify:`), decision/plan/approval always notify; unflagged Tests stay a quiet count or are refused. Same idempotency fields and terminal-notifier path.

Touches: `server.mjs` create path, `brain-requests.mjs` fields, notifier module.

Trade-offs: smallest change; but the brain still decides whether a Test exists, the count on the Area header still fills with asks Julian did not request, and the memo's first sentence ("change the ontology... driven by me") is not met. Useful only as step one of (a).

## (d) Verification as the last assignment in the Goal queue

Mechanism: ADR-0033 gives each Goal one ordered assignment queue. Add assignment kind `verify` whose worker is Julian: the launch editor Type select (`goal-launch-view.js:616`, `Implementation | Review`) gains `Verify (you)`; `tangent goal append <slug> --kind verify`; `tangent goal create --verify` appends it after the review. When the queue reaches a `verify` assignment the server creates the Test (as in (a)) and the assignment sits `running` until the Request is answered; Authorize submits a synthetic `review-result passed` at the current revision through `submitWorkerReport`, so closure reuses the one closure rule (`area-brain-domain.mjs:414-420`) with no second policy field. Reply with text stores `changes-required` and the brain appends new implementation assignments.

Touches: `area-brain-domain.mjs` (assignment kind, report source `julian`), `pipeline-record.mjs`, `server.mjs` queue advance and Request creation, launch editor, CLI, Work card (`deskPipelineAction` shows `Step N of M · You`).

Trade-offs: one queue explains the Goal's whole path including Julian's step, and `Ready for validation` becomes a real queue state; but it couples Julian's answer to the report revision lock (`stale-revision`), and a Goal with no pipeline still has no place for the flag.

Migration: flag stored as an assignment, not frontmatter; existing queues unchanged.

Common to all: the notification module belongs in `@tangent/agent-runtime/notify` (already exists, unused) or a new `agent-shell/app/julian-notify.mjs` with a `none` driver for tests and `TANGENT_VERIFY_READONLY` harnesses; every send is derived from the durable request record, never from an in-memory event, because launchd restarts the server.

## Counterexamples

- The legacy "approve closes the Goal" path still exists for pre-migration Tests (`server.mjs:6141-6153`) and governance forbids its Markdown twin (`packages/governance/src/index.ts:135`: `row.kind === "test" ... cascadeGoalDone` "restores legacy Markdown Test closure"). A naive "Accept marks done" must route through the revision-bound `goal-done` effect (`executeAuthorizedRequestEffect`, `:6059-6067`) or the typed review closure, not a new direct `cascadeGoalDone` call.
- `completionPolicy` is normalized and compared in `pipeline-record.mjs:114,128` and checked in `area-brain-domain.mjs:416`, but no caller ever sets it; adding a value means auditing `newPipeline` callers at `server.mjs:2893,2914` and the record migration path (`migrationProblem`).
- The vault README allowlists Goal-note frontmatter (`type, status, due, owners, waiting_on` for nodes; outcomes list their own) and says "No other tooling for the vault: no CLI, no schemas". Goal files already use `done_when`, `session`, `waiting_on` (server-emitted), so a `verify:` property needs the README, `server.mjs:793` parser, and `editGoalFile` updated together or the flag is silently dropped on the next edit.
- Tests without a Goal exist (neara: 7 of 16 carry no `goal`; subjects like "Onboarding redesign design doc for review"). A per-Goal flag cannot cover a Test whose subject is a Document or a brain decision; those must become `decision` Requests or be refused.
- `areaQuestions` (`work-desk-view.js:822-826`) counts child Areas' Requests on a parent header, and `closeRequestsForGoals` (`server.mjs:1571-1584`) walks every brain store. A notifier that fires per header repaint or per store would double-send for nested Areas; it must key on `request.id`.
- Requests move between brain generations (`handoverBrainRequests`, `brain-requests.mjs:135-141`) and close on `brain-ended`/`goal-ended`/`goal-dropped` without Julian's answer (`closedReason` values observed in live data). A notification keyed only on "open" state would linger or re-fire after handover; retraction must run on every `closeRequest` caller.
- `ask-dismissal-core.js` is still imported at HEAD (`shell.js:30`, `shell-state.js:2,42`) despite ADR-0033 saying it stays unreferenced; browser-local dismissal receipts and the durable `dismiss` route are two dismissal mechanisms that a "one list" design must reconcile.
- The Claude Code `Notification` hook only fires for tmux sessions named `wt-*` (`~/.wt/hooks/wt-hook.sh:20`); Tangent sessions are `<area>-brain-gN` and `<area>-<goal>-sN`, so reusing that hook as the delivery channel does nothing.
- `agent-runtime/notify.ts` sanitizes to 200 chars and embeds text inside an AppleScript string (`:52-54,66`); a subject with backslashes or non-ASCII quotes can still break the osascript literal, and `osascript display notification` attributes the notification to Script Editor, which Focus filters as Script Editor, not Agent Shell.
- Agent Shell has no URL routing and the native app declares no URL scheme; `terminal-notifier -open http://127.0.0.1:4321/` would open the browser, not `Agent Shell.app`, and would land on the Work root.
- The brain prompt is budgeted (`boundedBrainPrompt(..., BRAIN_STRUCTURAL_LIMIT)`, `server.mjs:4590-4593`; ADR-0033 "A prompt that cannot be built fails the brain start"). New instruction text in `Asking Julian` costs budget.
- The memory note `focus-concept-deleted.md` forbids re-proposing an Agent Shell "focus" mechanism; Julian's memo means macOS Focus modes. Area Focus (ADR-0027 amendment 2026-08-25, `work-desk-view.js otherDeskAreas`) is a third, unrelated concept; naming must not collide.
- The two design records for Work explicitly removed notification policy (`design-record-command-my-attention-from-work.md:30,137`) and argued from interruption research for deliberate review only (`design-record-tangent-around-the-area-brain.md:205-212`); ADR-0030 deferred native notifications "until later evidence". A design that adds OS notifications must record the reversal and its trigger (Julian's 2026-08-27 memo).
- Legacy pipelines without a brain still advance automatically (ADR-0029) and brain-less Areas produce no Requests at all since ADR-0033 removed the inferred fallback; a verify flag on such a Goal has no actor to create the Test unless the server does it on queue completion.
- Answer notices reach a brain only when its composer is empty (`brain-request-mechanics.md`); a Test that Julian answers during a long brain turn is heard only at the next generation via `answeredRequestLines` (`server.mjs:4490-4499`), so the notification click-through must not promise an immediate brain reaction.

## Unknowns

- Whether macOS Focus on this Mac filters osascript (`com.apple.ScriptEditor2`) and terminal-notifier notifications, and which Focus modes Julian runs: `~/Library/DoNotDisturb/DB/` is TCC-protected from the shell. Establish by sending `terminal-notifier -message test -group probe` with a Focus mode on and off, or by opening System Settings > Focus and reading the allowed apps.
- Whether the daily surface is `~/Applications/Agent Shell.app` (WKWebView, launchd server) or a browser tab: it determines whether `-activate dev.otto.agent-shell` or a `-open` URL is the right click target and whether the app must register with Notification Center itself (`UNUserNotificationCenter`) to appear under its own name in Focus filters.
- Whether Julian wants decision, plan, and approval Requests to notify at all, or only verify Tests; his memo covers verify only. Ask him.
- How the flag is set when the brain creates Goals from his voice or Journal capture (`describeWorkToBrain`, `capture` route): does the brain carry "verify" from his words into `--verify`, or does he flag afterwards on the Work card? Establish with him and with one worked example in the plan.
- Whether brains still file Tests after `b577256`: 4 on 2026-08-26 and 0 on 2026-08-27 in otto/tangent, and both brains are `inactive` now. Watch the next active day or read `tangent brain status` per Area.
- What Julian wants to happen to an unflagged Goal whose review fails or blocks (no Test, no closure): today the brain gets a notice and the Goal stays open; the memo does not say whether that should reach him.
- Whether `terminal-notifier` (brew, unsigned helper app) is acceptable long-term versus a signed `UNUserNotificationCenter` call inside `Agent Shell.app`; the latter needs the app to be running and a notification permission prompt once.
- Exact click behaviour: open the Request modal, the Goal reader with the finished output (per `goal-finished-work-waits-visibly-for-julian-s-validat.md`: "the validation request opens the finished output and the exact test steps"), or the brain terminal. No deep-link route exists to test against.

## Sources

- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0025-brain-writes-what-needs-julian.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0027-for-you-rows-are-direct-asks.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0029-brain-is-the-managed-work-controller.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0029-remove-threads-and-routines.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0030-area-triggers.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0033-area-brain-operating-model.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0034-audited-area-brain-workflow.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0039-durable-generic-agent-message-queue.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-work-contract/design-record.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-navigation-model/design-record.md
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-requests.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-routes.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-inbox.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/server.mjs (lines 793, 1174-1250, 1571-1600, 1766, 2521, 2610-2635, 2893-2914, 3205-3260, 4231-4261, 4301-4308, 4485-4600, 5285-5305, 5620-5640, 6050-6185, 6340-6360)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-brain-domain.mjs (lines 318-334, 375-430)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pipeline-record.mjs (lines 108-160)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/goal-lifecycle.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/goal-command.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/work-desk-view.js (lines 810-880, 960-1080, 1110-1132, 1150-1200, 1234-1260, 1510-1550)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/work-commands.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/goal-launch-view.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/shell.js (lines 30, 438, 616-649, 825, 1520)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/shell-state.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/ask-core.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/prompt-bestiary.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/refresh-lifecycle.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/native/main.swift
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/native/Info.plist
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/native/build-app.sh
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/native/install-launch-agent.sh
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/spec.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/brain.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/goal.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-runtime/src/notify.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-runtime/docs/public-api.md
- /Users/julianotto/Projects/otto-tangent/packages/governance/src/index.ts (lines 128-150)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/focus-shell-work-navigation-ui.test.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/work-table-ui.test.mjs
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/requests.json
- /Users/julianotto/.tangent/agent-shell/brains/neara/requests.json
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/inbox.json
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/brain.json
- /Users/julianotto/.tangent/agent-shell/triggers/state.json
- /Users/julianotto/.tangent/threads-status.json
- /Users/julianotto/.tangent/trees/README.md
- /Users/julianotto/.tangent/trees/otto/tangent/tangent.md
- /Users/julianotto/.tangent/trees/otto/tangent/plan-tangent.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-record-tangent-around-the-area-brain.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-record-make-completed-work-directly-testable.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-the-for-you-row-shows-only-direct-asks.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-record-diagnose-why-so-many-goals-sit-waiting-on-julian.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-record-command-my-attention-from-work.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-done-goals-timeline.md
- /Users/julianotto/.tangent/trees/otto/tangent/goal-park-a-request-now-get-told-later-if-it-still-ma.md
- /Users/julianotto/.tangent/trees/otto/tangent/goal-finished-work-waits-visibly-for-julian-s-validat.md
- /Users/julianotto/.tangent/trees/otto/tangent/goal-workers-hand-over-at-300k-and-a-fresh-copy-conti.md
- /Users/julianotto/.claude-otto/projects/-Users-julianotto-Projects-otto-tangent/memory/brain-request-mechanics.md
- /Users/julianotto/.claude-otto/projects/-Users-julianotto-Projects-otto-tangent/memory/julian-does-not-use-tangent-ui.md
- /Users/julianotto/.claude-otto/projects/-Users-julianotto-Projects-otto-tangent/memory/focus-concept-deleted.md
- /Users/julianotto/.agents/AGENTS.md
- /Users/julianotto/.claude/settings.json
- /Users/julianotto/.claude-otto/settings.json
- /Users/julianotto/.claude-otto/statusline.sh
- /Users/julianotto/.wt/hooks/wt-hook.sh
- /Users/julianotto/Library/Preferences/com.apple.ncprefs.plist (plutil -p)
- terminal-notifier -help (2.0.0, /opt/homebrew/bin)
- sw_vers, launchctl list, tmux list-sessions, ls ~/Applications
- PushNotification tool schema (ToolSearch)

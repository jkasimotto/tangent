# The mark loop: capturing agent failures, mining agent waste, and proving fixes

Date: 2026-07-05
Status: draft for review
Owner: Julian Otto
Supersedes: the draft of the same date (this revision adds the quality/efficiency model, file-level insights, and the tangent search revival).

## TL;DR

Tangent becomes a feedback loop for coding agents rather than a standalone eval tool. You capture agent failures the moment they annoy you, without leaving your Claude session (`/mark`). You mine your own telemetry for measurable waste, without rereading conversations (`tangent usage insights`). Both paths converge on the existing eval machinery, which proves a fix and renders the proof as a report you attach to the PR that ships the fix. The first end-to-end run of the loop is the PR that resurrects tangent search, justified by its own eval report. Roughly 70% of the machinery already exists; this document specifies the connecting pieces and the build order.

## The problem

You talk to coding agents all day, and the conversations are write-only. When Claude greps for six minutes instead of reading the docs index, you sigh, re-prompt, and the knowledge of what went wrong evaporates with the scrollback. Three costs follow from that:

First, improving agent context is guesswork. You edit CLAUDE.md and hope. Nothing tells you whether the edit changed behavior, and nothing protects the improvement when you edit again next month.

Second, the evidence for improvement is unreachable in practice. Eval frameworks assume an ML team with a curated dataset. An engineer with one annoying failure has no five-minute path from "that was wrong" to "here is proof my fix works", so the eval never happens.

Third, agent-config changes are unreviewable. A CLAUDE.md or skill PR today is vibes. The reviewer cannot see the failure it fixes or evidence that it fixes it, so review adds nothing and the context files drift on intuition.

Tangent already owns the raw material to fix all three: it indexes every native Claude/Codex/Gemini transcript, categorizes every tool call, and runs judged, worktree-isolated evals. What is missing is the loop that connects noticing a problem to proving its fix.

## The conceptual model: two lenses, one proof

Everything in this design hangs off one distinction.

Quality is human-judged and moment-anchored. "It did this in a way I did not like" is a judgment only you can make, and you make it reliably only at the moment of annoyance. Quality problems cannot be computed from telemetry; last chance to capture them is now. The instrument for quality is the mark: a ten-second capture, made in-session, that records what happened, what should have happened, and the hypothesis about what the agent did not know.

Efficiency is computed and aggregate. Time and tokens spent per tool category, which files were read, how often, and whether reading them led anywhere: these are facts already sitting in the Usage index. Nobody should reread conversations to find them. The instrument for efficiency is insights: deterministic queries over telemetry that show where agent effort goes and which context or tooling change would reduce it.

The lenses answer different questions ("what do I dislike?" versus "what is it wasting?") but converge on the same proof: an eval with N variants, binary judged criteria, and a report a reviewer can read in ten seconds. Quality marks tend to produce context fixes (a CLAUDE.md rule, a skill). Efficiency insights tend to produce capability fixes (a tool on PATH plus the skill that teaches it). The eval machinery does not care which lens produced the case.

```
QUALITY  (human, in the moment)      EFFICIENCY  (computed, aggregate)
  /mark in your session                tangent usage insights
        │                                     │
        ▼                                     ▼
      mark record  ◄──── candidate ────  exemplar conversations
        │
        ▼
  tangent mark to-eval  ──►  eval run (N variants)  ──►  report.md / report.html
                                                              │
                                                              ▼
                                                    PR: fix + evidence
```

## Workflows

### Reactive: mark it the moment it annoys you

You are working in a normal Claude Code session. Claude spends six minutes grepping instead of reading `docs/index.md`. You type:

```
/mark you should have read the docs index first
```

The same Claude that made the mistake handles the capture, because it has the full context of its own failure and because you are annoyed now, not at some future triage session. It quotes the offending moment, states observed versus expected behavior, inspects the CLAUDE.md and skills that were in its context to answer "what did I not know?", and persists a mark via `tangent mark --json`. Then, in the same exchange, it proposes the context fix and offers to scaffold the proving eval. Total interruption: under a minute, and you never left your session.

Diagnosis happens at mark time by design. There is no separate diagnose service for this path; the session's own model is the diagnoser, for free, with better context than any offline process would have.

### Hypothesis-driven: mine telemetry for cases, never reread conversations

You built something you believe helps (the motivating case: tangent search) and need realistic test tasks. You ask the telemetry, not your memory:

```
tangent usage insights --days 30
```

This prints where agent time and tokens actually went, and ranks the conversations that spent the most on finding information. You pick an exemplar, mark it as a candidate (`tangent mark --session <id> --kind candidate`), and scaffold an eval whose variants differ by capability: `baseline` versus `with-search`. The metrics that answer "faster? fewer tokens?" are already collected per variant.

### Ship: the report travels with the fix

`tangent eval report <run> --format md` emits a verdict matrix you paste into the GitHub or Phab description of the PR that changes CLAUDE.md, adds the skill, or introduces the tool. `--format html` emits a single self-contained file with drill-down into judge reasoning, context diffs, and full per-variant conversations, attached as evidence. The reviewer sees the failure, the fix, and the before/after in one artifact.

Over time, marks accumulate into a regression suite for agent behavior. When a new model ships or you rewrite CLAUDE.md, you re-run the suite and see whether the agent still avoids every failure mode you ever caught.

## What the user sees

Design rule for every surface: information must jump out visually or it has failed. Color encodes exactly one thing per surface. Anything that requires reading and thinking to notice goes below the fold or gets cut.

### The /mark skill (primary capture surface)

A conversational exchange, not a form. Claude proposes observed/expected/hypothesis from its own context; you correct or confirm in one message. The skill ends by printing the mark id and the two follow-up commands (`to-eval`, `list`), so the trail back is one paste away.

### tangent usage insights (the efficiency lens)

The unit of the surface is the finding, not the chart. A chart still makes the user read and think; the system should do the reading. Deterministic generators scan the window and emit ranked findings; charts are reduced to a one-line distribution header for orientation.

```
INSIGHTS · all projects · last 30 days
Agent time 41h   finding info 34% ▓▓▓▓▓░░░░░
                 executing    22% ▓▓▓░░░░░░░
                 writing      19% ▓▓▓░░░░░░░

FINDINGS (ranked by cost)
 3.2h  dart analyze ran on the whole client 41×, median 4m38s
       remedy: scope or cache the command
       [view runs]  [mark → eval]  [park]

 2.1h  polez: 6 sessions re-read 10+ files to locate one symbol
       remedy: missing map / structural search
       [view sessions]  [mark → eval]  [park]
```

A finding is `{generator, subject, cost (time and tokens), evidence (session ids), remedy category, state}`. Findings rank by wall-clock cost with tokens shown alongside. Every finding carries its evidence one click away and a `mark → eval` action that creates a `kind: candidate` mark pre-filled from the finding.

Four generators ship in v1, all pure aggregation over the index:

1. **Info-finding-heavy sessions**: sessions ranked by read+search time and tokens before the first write. The case miner for the tangent search eval.
2. **Recurring long commands**: execute-category calls grouped by normalized command head (`dart analyze`, `npm run build`), ranked by total time across the window. Catches "it keeps running dart analyze on the entire client."
3. **Re-read churn and hot files**: the same file read repeatedly within one session; most-read files across all sessions (candidates for CLAUDE.md map entries).
4. **Failure/retry loops**: commands that errored and were re-run repeatedly; the remedy is usually documenting the correct invocation.

Findings recur while the underlying pattern persists, so the feed has state: each finding can be parked. Parked findings collapse out of the feed and resurface only if their cost grows notably since parking (threshold tunable, on the order of +50%). Park state is keyed by a stable fingerprint (generator + subject + repo) and stored beside the usage index; it is curation, not a queue. Marking a finding also removes it from the feed and leaves the paper trail.

The CLI prints the same feed (`tangent usage insights`, with `--days`, `--repo`, `--generator` filters); the Usage UI renders it as the Insights view with the header, the feed, and drill-down into the existing per-conversation bottleneck view. File-level detail per conversation (which files were read, re-read counts, estimated context cost, whether the read led anywhere) backs generators 1 and 3 and is visible in the drill-down.

Each remedy category exists because the point of the efficiency lens is "how do I improve the context I give it":

| Pattern in the data | Likely remedy |
|---|---|
| Many files read before the right one | Missing map: CLAUDE.md pointer or docs index entry |
| Same file read repeatedly in one session | Context too big to retain; split the file or summarize in CLAUDE.md |
| Long grep/glob chains to locate a symbol | Missing tool: structural search (tangent search) |
| Reads spread across many sessions on the same paths | Missing skill: a documented workflow for that subsystem |
| Recurring long or failing commands | Document the scoped/correct invocation in CLAUDE.md, or cache |

Honesty constraint: per-file token cost is an estimate derived from tool-result size, and "led anywhere" is a proxy (the file, or a path it contains, later appears in a write-category tool call or in the final assistant output). Both are labeled as estimates in the UI and validated against real transcripts during implementation.

### The report artifact (what a reviewer sees)

One report model, two renderings, produced by a dedicated static renderer (no bundled app):

`report.md` pastes into a PR description and renders natively on GitHub and Phab. Top to bottom: a one-line task statement with a link to the originating mark; the verdict matrix (criteria as rows, variants as columns, pass/fail cells, baseline column marked); a variant card row (pass rate, wall time, total tokens, tool calls by category); deltas against baseline.

`report.html` is a single self-contained file: inline CSS derived from ui-tokens, minimal inline JS for collapse/expand, zero network fetches. It adds drill-down below the same matrix: per-criterion judge reasoning, the context diff between variants, and full per-variant conversation transcripts with tool-call summaries. It attaches to Phab directly; GitHub PR comments reject bare .html, hence the markdown twin (zip or commit the HTML next to the change when GitHub needs the full artifact).

Both renderings are reachable from the eval UI run view as export buttons (`report.md`, `report.html`) as well as from the CLI flags; the buttons download the same renderer output.

At-a-glance rules: color means pass/fail and nothing else; criteria rows sort discriminating-first, so rows where variants disagree float to the top and unanimous rows sink; matrix plus cards fit one screen without scrolling. N variants are N columns; nothing in the model or the renderers assumes two.

### The marks inbox (eval UI)

A list view: status chips (`new`, `suggested`, `triaged`, `eval-created`, `fixed`, `dismissed`), observed/expected/hypothesis, a link out to the conversation in the Usage app (by URL, never by package import), and a link to the created eval and its latest run. Actions: dismiss, mark fixed, open the to-eval scaffold. Suggested marks (phase 3) appear here for confirm-or-dismiss curation; nothing auto-creates evals.

## Where the data lives

| Data | Location | Format | Owner |
|---|---|---|---|
| Conversation telemetry | `~/.tangent/usage/` SQLite index over native transcripts (`~/.claude*/projects`, Codex, Gemini) | existing index; messages carry stable `ordinal` per session | `@tangent/usage-*` |
| Marks | `~/.tangent/marks/<markId>.json`, one file per mark, cross-repo by design | `tangent.mark.v1` (below) | `@tangent/eval` |
| Insights park state | beside the usage index, fingerprint-keyed | small JSON | `@tangent/usage-*` |
| Eval specs | `evals/<name>/eval.json` + `prompts/*.md`, in the target repo | existing `eval.spec.v1` | `@tangent/eval` |
| Context snapshots | git refs `refs/tangent/eval/contexts/<name>` in the target repo | existing | `@tangent/eval` |
| Run results | run dir sidecars: `metrics.json`, `evaluation.json`, `report.json`, `reviews.json` | existing | `@tangent/eval` |
| Rendered reports | `report.md` / `report.html` written wherever `--out` points, typically committed next to the change they justify | new | `@tangent/eval` |
| Search index (revived) | `~/.tangent/search/repos/<repo>-<hash>` SQLite | existing at `21dfb14^` | `@tangent/search` |

The mark record:

```json
{
  "schema": "tangent.mark.v1",
  "id": "20260705-143012-read-docs-first",
  "at": "2026-07-05T14:30:12Z",
  "kind": "failure",
  "anchor": {
    "provider": "claude",
    "sessionId": "<uuid>",
    "conversationId": "claude:<uuid>",
    "transcriptPath": "~/.claude/projects/<slug>/<uuid>.jsonl",
    "ordinal": 142
  },
  "repo": { "root": "/Users/.../polez", "branch": "dev/foo" },
  "observed": "greped the codebase for 6 minutes instead of reading docs/index.md",
  "expected": "should have read docs/index.md before searching",
  "hypothesis": "CLAUDE.md never says docs/index.md is the entry point",
  "quote": "<verbatim excerpt of the offending turn>",
  "status": "new",
  "links": { "eval": null, "fix": null }
}
```

`kind` is `failure` (default, quality lens) or `candidate` (efficiency lens: a mined exemplar whose observed/expected describe cost, e.g. "spent 11 min in read/search" / "should orient via structural search"). The anchor keys off the Usage index's stable message ordinals; when a session is not yet indexed at capture time, the anchor keeps `transcriptPath` plus timestamp and the ordinal resolves lazily on first view. The shape generalizes the existing `EvalReviewNote` (`packages/eval/src/server/reviews.ts`), which already models anchored good/bad annotations, from eval artifacts to live conversations.

## How it is built

### What already exists (the 70%)

- Anchored annotation shape: `reviews.json`, `packages/eval/src/server/reviews.ts`.
- LLM-judge primitive, twice: `packages/eval/src/runners/judge.ts` and `packages/rollup/src/metrics/runner.ts`, both ~40 lines shelling `claude -p` with a JSON contract. Binary criteria, explicit per-eval judge model, rubric in `eval.json`: all fixed by ADR-0013.
- N-way variants: `EvalVariantSpec[]` is already a list; contexts are git-ref snapshots; runs are parallel worktrees; `metrics.json` per variant already collects wall time, tokens, and tool calls.
- Task-to-eval scaffolding: `tangent eval capture task` plus the `setup-tangent-eval` skill.
- Tool categorization: every tool call is normalized to `read`/`search`/`write`/`execute` with `durationMs` and `targetPaths` per provider (`packages/usage-providers/src/providers/*/native/normalize.ts`); per-turn bottleneck ranking exists in `packages/usage-ui-data/bottlenecks.ts`.
- Tangent search: complete package and skill at commit `21dfb14^` (structural TS/Dart indexer, `symbol`/`callers`/`skeleton`/`open-plan` commands).

### New components

Marks module, in `@tangent/eval` (`src/marks/`): types, per-file JSON store over `~/.tangent/marks/`, session resolution (cwd to newest transcript across `claudeHomes()` profiles, lazy ordinal resolution via a single-session index import). Placement follows the boundary rules: marks reference Usage conversations and feed evals, Usage must never depend upward, and eval already depends on `@tangent/usage-index-sqlite`.

CLI: top-level `tangent mark`, lazy-loading the eval module like the other product stubs in `src/cli/index.ts`. Subcommands: bare capture (cwd-resolved current session), `list`, `show`, `update`, `to-eval`. `--json` accepts a full record on stdin; that is the skill's entry point.

`tangent mark to-eval <id>`: composes existing scaffolding into `evals/<slug>/eval.json` plus `prompts/task.md`. Task prompt: the real user message at the anchor, pulled from the index and left editable. Variants: two context snapshots captured around the fix (baseline before, fixed after; the skill drives the ordering), or capability variants where the snapshot difference is a skill file and the tool is on PATH. Evaluator block: binary criteria drafted from `expected`, judge model set explicitly (haiku default, raisable), per ADR-0013.

The /mark skill: `skills/mark-agent-mistake/` in-repo, installed to `~/.claude/skills/`, following the repo's dual-copy pattern. Steps: quote the moment, confirm observed/expected in one exchange, answer "what did I not know" by inspecting the context files that were loaded, persist via `tangent mark --json`, propose the fix, offer `to-eval`.

Insights, in Usage (pure telemetry aggregation, no upward dependency): finding generators (`insightsForDataset`) in usage-core or usage-ui-data reusing the `bottlenecks.ts` shapes, exposed as `tangent usage insights` and as the Insights view in the Usage UI. The four v1 generators (info-finding-heavy sessions, recurring long commands, re-read churn and hot files, failure/retry loops) share one finding shape and one park-state store (fingerprint-keyed JSON beside the usage index). File detail derives from `targetPaths`: read counts per file, re-read detection, estimated cost from result sizes, and the downstream-use proxy (path later appears in a write call or final output). The `mark → eval` action on a finding shells to `tangent mark` by URL/command, keeping usage free of any eval import.

Report renderer, in `@tangent/eval` (`src/report/`): one view-model assembled from the run sidecars (variants, criteria, verdicts, metrics, deltas, discriminating-first sort), one markdown renderer, one HTML renderer, wired as `--format`/`--out` on `tangent eval report`. Golden-file tests for both.

Eval UI: marks inbox view; `ScoringCompare`/`compare-model.ts` generalized from two variants to N with a designated baseline.

Sweep (phase 3), in `@tangent/eval` (`src/marks/scan.ts`, `tangent mark scan`): the rollup correction-judge template pointed at recent conversations, writing `suggested` marks. It is seeded by the deterministic insights ranking, so the model describes and classifies moments the metrics already flagged (plus catches non-metric failures like user corrections) instead of hunting blind. Cheap model, explicit, per ADR-0013's spirit.

### Alternatives considered

Marks in a new package (or in usage) instead of eval. A new package adds workspace, governance, and docs surface for one small module; usage is forbidden from knowing about evals, and marks exist to become evals. Eval wins unless marks grow independent consumers, at which point extraction is mechanical.

Offline diagnose service instead of in-session diagnosis. An offline service (judge reads the transcript later) loses the context the live session already has, adds latency to the exact moment the user wants action, and costs another model call. It loses because the primary capture surface is a skill running inside the session that made the mistake. Suggested marks from the sweep still get offline diagnosis at triage; that path keeps the judge template.

Bundled eval-ui app as the report instead of a static renderer. Richer interactivity, but heavy, fragile inside PR workflows, and unreadable as a diff artifact. The static twin renders on GitHub/Phab natively (md) and opens anywhere (html). Loses only if reports need live re-querying, which is a non-goal.

LLM-first insights instead of metrics-first. Having a model read every conversation to find waste is expensive, slow, and unnecessary when the index already has categories, durations, and paths. The model earns its keep describing flagged moments (phase 3), not finding them.

### Constraints inherited from ADRs

ADR-0013: judge criteria are binary, the judge model is explicit per eval with no global default, and the rubric is version-controlled in `eval.json`. Package-boundary ADRs (0002/0003/0007/0009) and `docs/architecture/package-boundaries.md`: usage never depends on rollup/eval/search; eval and rollup may consume usage; governance lints enforce this. The slim-schema note in `usage-index-sqlite` (ADR-0012 lineage): anchor to `sessions`/`messages` (id, ordinal, turn_id), never resurrect the dropped per-tool tables; per-tool detail is reprojected on demand.

## Build plan

Order chosen so each phase ships something usable alone, and so the flagship eval (phase 2c) exercises every prior piece as its acceptance test. All work happens in dev worktrees (`node scripts/dev-worktree.mjs create mark-loop`); UI changes are verified through the combined `tangent ui` shell, not per-app surfaces.

Phase 1, capture. Marks module (types, store, resolve), `tangent mark` CLI with top-level wiring, `to-eval` scaffolder, the /mark skill. Tests: store round-trip, resolution against fixture transcripts, golden `eval.json` from `to-eval`. Exit: marking a real session from a live conversation takes under a minute and `to-eval` emits a runnable spec.

Phase 2, prove and show. Report view-model plus md/html renderers with golden-file tests; marks inbox in eval-ui; N-way compare. Exit: a run renders to a report.md that reads correctly on GitHub, and report.html opens self-contained.

Phase 2b, mine (parallel with 2, pure usage). The four finding generators, park state, `tangent usage insights` CLI, Insights view in the Usage UI, file-level drill-down with the remedy table. Exit: opening Insights shows a ranked findings feed where the top item is a real, actionable pattern (e.g. a recurring long command) with its evidence one click away.

Phase 2c, flagship: tangent search revival. Restore `packages/search` and `skills/tangent-search` from `21dfb14^` on a dev branch; re-wire workspaces, root CLI, governance allowlist. Mine two or three information-heavy cases via insights; run `baseline` versus `with-search`; the revival PR carries `report.md` as its evidence. This run is the acceptance test for the entire loop, and the report is allowed to say the tool did not help; an honest negative is still the loop working.

Phase 3, find. `tangent mark scan` sweep writing `suggested` marks, seeded by insights; inbox curation. Deferred until the manual loop has proven itself, because suggested marks are only worth triaging once triage is cheap.

Validation at every phase: `npm run check`, `npm run test`, `npm run governance`, `npm run build`. Architecture docs (ARCHITECTURE.md, package docs, `package-boundaries.md`) update in the phase that changes them; the marks-in-eval placement and the usage-ui-links-by-URL rule get an ADR when phase 1 lands.

## Non-goals

- No automatic eval creation and no automatic context edits. Humans confirm every mark-to-eval and every CLAUDE.md change; the sweep only suggests.
- No hook-based capture. Capture reads native transcripts, per ADR-0004; nothing here reintroduces provider hooks.
- No hosted or team-shared mark store. Marks are local files; sharing happens through the report artifact in PRs.
- No live re-querying reports. The html report is a snapshot; the app remains the place for interactive exploration.
- No LLM in the core insights path. Deterministic aggregation first; models describe, they do not discover.

## Open questions

- How faithful is the file-usefulness proxy? "Read but never referenced again" may flag legitimately useful background reading. Validate against a sample of real conversations in phase 2b and tune before giving it strong visual weight.
- Prompt extraction quality in `to-eval`: real user messages are messy and sometimes span turns. The scaffold leaves `prompts/task.md` editable; if editing turns out to be the norm, add an LLM-assisted cleanup step to the skill.
- Session resolution edge cases: multiple concurrent sessions in one cwd resolve to "newest transcript", which can mis-anchor. `--session` is the escape hatch; revisit if it bites in practice.
- Whether capability variants need agent-config support (PATH manipulation per variant) beyond context snapshots. The tangent search eval will answer this; if the binary must differ per variant, extend `EvalAgentConfig` then.

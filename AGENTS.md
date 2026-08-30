# Agent Notes

Purpose: Tangent is a local monorepo for coding-agent tooling: conversation telemetry, rollup notes, eval runs, and shared infrastructure.

## On-disk layout (`~/.tangent/`)

All Tangent state lives under `~/.tangent/`. Know these paths:

| Path | Contents |
|---|---|
| `usage/global/index/usage.sqlite` | Global SQLite index across all sessions on the machine (tables: sessions, turns, messages, events, conversations, source_files, provider_capabilities, meta). Rebuildable projection — native transcripts are the source of truth. |
| `usage/repos/<hash>/index/usage.sqlite` | Per-repo SQLite index |
| `usage/repos/<hash>/` | One directory per repo, keyed by a hash of the repo path |
| `usage/global/insights/` | Aggregated deterministic insights (e.g. `park.json`) |
| `trees/` | Git-managed project tree; node directories only, no content files. README.md has the vault rules. |
| `trees/.agents/skills/remember/` | Canonical Tangent `/remember` skill. It lives at the vault repository root so agents launched in `~/.tangent/trees` can discover it. Agents working in this repository must use that copy when inspecting or changing Journal capture behavior. |
| `marks/` | Captured agent-failure marks (`tangent.mark.v1` JSON), owned by @tangent/eval |
| `eval/runs/` | Eval run manifests, variant work dirs, metrics, reports, diffs |
| `loops/` | Agent loop logs (plan, scope, implement, review, deploy, ux, watch, feedback) |
| `worklog.jsonl` | Time-tracking worklog entries (entity, cwd, name, estimate, actual minutes) |
| `feedback.jsonl` / `feedback-triage.jsonl` | User feedback capture |


### CLI quick reference

```bash
# What sessions exist for a repo
 tangent usage status .

# List / get / report sessions
tangent usage sessions list .
tangent usage sessions get <id>
tangent usage sessions report latest --provider claude --json
tangent usage sessions report <session-id> --json

# Timeline for a session
tangent usage sessions timeline latest --metric duration --group kind --format json

# Query messages across sessions (filter by role, date, char count, etc.)
tangent usage messages query --role user --min-chars 500 --json
tangent usage messages query --json --since 2026-07-10

# Query steps and tools
tangent usage steps query --session latest --json
tangent usage tools query --session latest --json

# Analytics aggregation
tangent usage analytics aggregate --session latest --metric durationMs.sum --metric tokens.total.sum --group step.kind --json

# Raw telemetry events
tangent usage raw events --session latest --json

# Launch the local web UI
 tangent usage ui
```

All `--json` commands emit a `UsageResult<T>` envelope. `--scope all` discovers sessions across all supported local agent roots (all `~/.claude*` profiles, Codex, Gemini).

### SDK quick reference

```ts
import { openUsage } from "@tangent/usage/core";

const usage = await openUsage({ repo: ".", index: "auto" });

// Query messages
usage.messages.query({
  where: { role: "user", textChars: { gte: 500 } },
  orderBy: [{ field: "createdAt", direction: "desc" }]
});

// Session timeline
usage.sessions.timeline("latest", {
  metric: "selfDurationMs",
  bucketBy: "kind",
  nesting: "tree"
});

// Analytics
usage.analytics.aggregate({
  scope: { sessionId: "latest" },
  groupBy: ["step.kind"],
  metrics: ["tokens.total.sum", "durationMs.sum", "count"]
});
```

### SQLite direct query (fallback)

If the CLI/SDK is unavailable, the global index at `~/.tangent/usage/global/index/usage.sqlite` has tables `sessions`, `messages`, `turns`, `events`, `conversations`. The `messages` table has columns including `session_id`, `role`, `model`, `created_at`, `text_preview`, `text_full`, `token_usage_json`. Query it with `sqlite3` to find sessions by model, date, or content, then use the CLI for full reports.

## Packages

- @tangent/core: pure CLI specs, args, JSON/config, hashes, time, and small helpers.
- @tangent/repo: repo discovery, git, worktree, and path helpers.
- @tangent/agent-runtime: shared process execution and agent runner primitives.
- @tangent/governance: architecture, docs, dependency, and duplication lints.
- @tangent/usage: conversation telemetry domain, native transcript indexing, schemas, datasets, SDK, CLI. Sub-packages: `usage-schema` (types only), `usage-core` (schemas, query, projections, client — no SQLite/UI), `usage-providers` (native transcript normalization), `usage-index-sqlite` (optional SQLite indexing, repo loading, archive), `usage` (full CLI + local UI server + `usage-ui` assets).
- @tangent/rollup: private rollup notes from Usage turns.
- @tangent/eval: coding-agent eval preparation, execution, collection, and reports.
- @tangent/search: structural indexing and search over TypeScript and Dart source (standalone, no Usage/Rollup/Eval dependency).
- @tangent/agent-shell: the vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent document`, `tangent vault commit`), the cross-agent messaging CLI (`tangent agent list|send`), the pipeline CLI (`tangent goal start`, `tangent goal append`), the brain CLI (`tangent brain status|stop|request`, `tangent area create`), the server CLI (`tangent shell rebuild`), and the study partner launcher (`tangent study`); thin HTTP clients to the running Agent Shell server except `vault commit` and `study`. `vault commit` writes the vault's git history, and `study` spawns a local interactive session. The Agent Shell server owns pipelines (ADR-0023) and Area brains (ADR-0024).

Architecture docs:
- ARCHITECTURE.md
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/agent/coding-rules.md
- docs/agent/validation.md

Primary entry point:
- The daily product is Agent Shell: `packages/agent-shell/app/server.mjs` on port 4321. The `@tangent/agent-shell` package is its CLI surface. Verify visible changes against this server.
- The combined launcher and shell were deleted on 2026-08-14. See docs/decisions/ADR-0019-delete-combined-tangent-ui.md. Never restore the shell, command, or manifest discovery.
- Usage and Eval keep their standalone servers as secondary analysis surfaces: `tangent usage ui` and `tangent eval ui`.
- The Usage UI defaults to all projects across every Claude profile (`~/.claude*/projects`, unioned by `claudeHomes()`, with `scope: "all"`).
- The recent view uses `--days` and defaults to 7. Keep the view cross-project and cross-profile.

Product direction: the mark loop (design contract: docs/superpowers/specs/2026-07-05-mark-loop-design.md):
- Tangent is a feedback loop for coding agents, not a standalone eval tool: notice -> mark -> diagnose -> fix -> prove -> ship. Evals are a byproduct of noticing, never a project you set up.
- Two lenses, one proof. Quality is human-judged and moment-anchored: marks are captured in-session (/mark skill) in seconds, diagnosed at mark time by the session's own model. Efficiency is computed: insights are deterministic aggregations over the Usage index; models describe findings, they never discover them. Both lenses converge on N-way evals with binary judged criteria.
- Capture must never break the user's flow. Any capture surface that takes over a minute or forces a context switch is wrong.
- The unit of insight display is the finding, not the chart: ranked by wall-clock cost, plain language, evidence one click away, remedy tag, mark->eval action, park/dismiss curation (parked findings resurface only if cost grows).
- Proof travels with the fix: report.md (pasteable verdict matrix) and report.html (single self-contained file) attach to the PR that changes CLAUDE.md/skills/tools. Color encodes pass/fail only; criteria where variants disagree sort first.
- Nothing auto-edits context files and nothing auto-creates evals; humans confirm every step. Marks live in ~/.tangent/marks/ owned by @tangent/eval; usage links to eval by URL only, never by import.

Development workflow:
- Do not create or use a git worktree unless the user explicitly asks for one. By default, make requested changes in the current checkout and branch.
- Other agents can work in this checkout at the same time. Always commit your own changes atomically. Stage only the files and hunks you changed, preserve every unrelated working-tree change, and never sweep another agent's work into your commit.
- When the user explicitly requests a worktree, create one with `node scripts/dev-worktree.mjs create [name]`. This creates `dev/<name>` from main.
- In that worktree, `node scripts/verify-app.mjs [usage|eval]` starts a read-only instance on a separate port. It does not conflict with the live app.
- IMPORTANT: when working in an explicitly requested worktree, target it with absolute paths or run from its directory.

Validate work:
- npm run check
- npm run test
- npm run governance
- npm run build

Never:
- Do not add vertical app dependencies except rollup/eval -> usage.
- Do not reintroduce provider hook installation, hook recording, or hook allowlist tracking.
- Do not duplicate parseArgs, runProcess, repo discovery, or git/worktree helpers in vertical apps.
- Do not import another package's src internals; use public exports.
- Do not let @tangent/core shell out, write provider config, or learn product schemas.
- Do not create unrelated git branches. A user-requested dev worktree branch (`dev/<name>`, see Development workflow) is the expected exception; otherwise commit on the current branch.

When architecture changes:
- Update ARCHITECTURE.md and the relevant docs/architecture/*.md file.
- Update package docs/index.md, docs/architecture.md, and docs/public-api.md when package responsibilities or exports change.
- Add or update governance lints for enforceable rules.
- Record durable decisions in docs/decisions/ADR-*.md.

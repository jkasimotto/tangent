# Agent Notes

Purpose: Tangent is a local monorepo for coding-agent tooling: conversation telemetry, rollup notes, eval runs, and shared infrastructure.

Packages:
- @tangent/core: pure CLI specs, args, JSON/config, hashes, time, and small helpers.
- @tangent/repo: repo discovery, git, worktree, and path helpers.
- @tangent/agent-runtime: shared process execution and agent runner primitives.
- @tangent/governance: architecture, docs, dependency, and duplication lints.
- @tangent/usage: conversation telemetry domain, native transcript indexing, schemas, datasets, SDK, CLI.
- @tangent/rollup: private rollup notes from Usage turns.
- @tangent/eval: coding-agent eval preparation, execution, collection, and reports.

Architecture docs:
- ARCHITECTURE.md
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/agent/coding-rules.md
- docs/agent/validation.md

Primary entry point:
- ALWAYS think `tangent ui`, never the specific app. `tangent ui` is how the user enters every time. It is the combined launcher in `src/cli/product.ts` (`runTangentUiCommand`), mounting usage + eval together. The standalone per-app commands (`tangent usage ui`, `tangent eval ui`) are secondary; do not assume the user runs them, and never treat a per-app surface as "the app."
- Any change a user sees (UI, styling/CSS, layout, backdrop, behavior on launch, scope, default window, mounted routes, app discovery) must be made and verified through `tangent ui`, not just the per-app package. The combined shell (`@tangent/tangent-ui`) renders its own chrome and backdrop and mounts each app as an embedded module, so the file that controls a per-app surface (e.g. `packages/usage-ui/src/app.css`) is often NOT what `tangent ui` renders. Trace which element/CSS the combined shell actually paints (e.g. `.tangent-shell`, the shell `app.css`, the app's `embedded.css` loaded via `/api/ui/apps` stylePaths) and verify the change in a `tangent ui` instance before claiming it works.
- The Usage panel defaults to all projects across every Claude profile (`~/.claude*/projects`, unioned by `claudeHomes()`; `scope: "all"`), bounded to a recent view window (`--days`, default 7). Keep it cross-project and cross-profile: never silently scope it back to a single repo or a single `~/.claude`.

Development workflow:
- Do substantive code changes in a dedicated git worktree, never on the `main` checkout the user runs live. The user keeps `tangent ui` running on `main` while you work; develop in the worktree and let the user (or you) verify the change from the worktree's own app instance.
- Create one with `node scripts/dev-worktree.mjs create [name]` (branches `dev/<name>` off main). From the worktree, `node scripts/verify-app.mjs ui` boots a read-only instance on its own port, so the live main app and the worktree instance coexist with no port or `~/.tangent` collision.
- IMPORTANT: when working in a worktree, target it with absolute paths or run from its directory. Editing the main `otto-tangent/` checkout instead silently changes the app the user is running live.

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
- Do not create unrelated git branches. The dev worktree branch (`dev/<name>`, see Development workflow) is the expected exception and needs no separate per-task permission; otherwise commit on the current branch.

When architecture changes:
- Update ARCHITECTURE.md and the relevant docs/architecture/*.md file.
- Update package docs/index.md, docs/architecture.md, and docs/public-api.md when package responsibilities or exports change.
- Add or update governance lints for enforceable rules.
- Record durable decisions in docs/decisions/ADR-*.md.

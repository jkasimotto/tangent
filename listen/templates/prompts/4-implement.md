# Stage 4: Implement

You are the implementation stage. Execute the plan, validate it, and hand a finished change to review.

## Your item
Read `30-plan.md` (and `10-scope.md`, `20-ux.md` for context) from the dossier (`listen dossier path <slug>`). `30-plan.md` is authoritative; execute it. If reality diverges, implement the closest faithful interpretation and record the divergence.

## Where to make changes
<!-- EDIT: If users run your project live from this checkout, do the work in an isolated copy (a git worktree / branch) so you do not disturb them, then hand the branch to review/deploy. If isolation is unnecessary for your project, work in place. Describe your project's isolation approach here. -->

## Implement, then validate
Execute the plan. Then run your project's validation and capture the results:
<!-- EDIT: replace with your real commands, e.g.: -->
- `npm run check`  (or: typecheck / lint)
- `npm run test`
- `npm run build`

Rules:
- NEVER claim green if red. Paste failing output verbatim into `40-implementation.md`.
- Fix what you reasonably can and re-run. Validation must be clean before you advance.
- If it cannot pass after reasonable effort, do NOT advance: record the blocker, then
  `listen dossier advance <slug> planned --block "<reason>"` and finish. Honest-stuck beats fake-green.

## On success
1. Write `40-implementation.md`: what changed (files, key decisions), how it satisfies the plan, validation results, and any divergences.
2. **Commit your work** (your job is not done until the working tree is clean and the change is committed, so deploy can ship it).
3. `listen dossier advance <slug> implemented --note "<one-line summary>"`

## Boundaries
Do not deploy or release. Stop at `implemented`.

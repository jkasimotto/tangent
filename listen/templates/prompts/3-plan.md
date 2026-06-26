# Stage 3: Plan

You are the planning stage. Produce an implementation plan precise enough that the implementer executes it without re-deciding anything.

## Your item
Read `10-scope.md` and `20-ux.md` from the dossier (`listen dossier path <slug>`). Trace the relevant code: who calls what, with what inputs, in what context.
<!-- EDIT: point agents at your architecture docs / conventions so the plan respects existing patterns and boundaries. -->

## Write `30-plan.md` in the dossier
- **Files to change** (exact paths) and what changes in each.
- **Public APIs / seams / data shapes** touched, and any schema or contract implications.
- **Reuse**: existing functions/utilities to use instead of new code.
- **Validation steps**: how the implementer proves it works. <!-- EDIT: your project's check/test/build commands. -->
- **Risks / divergences**: anything the implementer should watch for.

## Advance
`listen dossier advance <slug> planned --note "<one-line summary>"`

## Boundaries
No code changes. Only the plan artifact.

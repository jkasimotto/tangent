# @tangent/ui-components Architecture

Components in this package understand generic concepts such as metrics, sessions, variants, diffs, files, artifacts, statuses, and caveats. They must not import product domain packages.

Rules:
- Prefer `@tangent/ui-primitives` for controls.
- Put page templates in `@tangent/ui-patterns`.
- Keep formatting deterministic and testable.

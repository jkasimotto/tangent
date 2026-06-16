# @tangent/eval-ui Architecture

Eval UI is a product-owned Svelte app. It renders serializable view models from `/api/eval/*` and does not import Eval domain code directly.

Rules:
- Keep domain artifact discovery and filesystem/git access in `@tangent/eval/server`.
- Keep the UI read-only in V1; no prepare, run, collect, cancel, or mutation controls.
- Support both standalone serving and embedded mounting inside the combined Tangent UI shell.

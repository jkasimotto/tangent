# @tangent/eval-ui Architecture

Eval UI is a product-owned Svelte app. It renders serializable view models from `/api/eval/*` and does not import Eval domain code directly.

Rules:
- Keep domain artifact discovery and filesystem/git access in `@tangent/eval/server`.
- The UI may launch runs through `POST /api/eval/runs` and poll status, but holds no run mechanics itself; preparation, execution, and collection stay in `@tangent/eval/server`.
- Support both standalone serving and embedded mounting inside the combined Tangent UI shell.

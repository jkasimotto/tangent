# @tangent/eval-ui Public API

Public import paths:
- `@tangent/eval-ui`
- `@tangent/eval-ui/assets`

Important exports:
- `mountApp(target, context)` from the embedded bundle.
- `evalUiAssets` for local static serving.
- `createEvalApiClient(baseUrl?)` from `client.ts`, including `listSpecs` and `launchRun` for launching runs plus `getRun` for status polling.

The package owns browser assets only. Server routes are exported by `@tangent/eval/server`.

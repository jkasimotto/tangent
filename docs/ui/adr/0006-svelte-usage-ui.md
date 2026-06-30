# ADR 0006: Svelte Usage UI

Decision: use Svelte, TypeScript, and Vite for `@tangent/usage-ui`.

Reason: Usage needs a lightweight local UI without the old shared React platform dependency chain, while preserving framework-agnostic server APIs through `@tangent/ui-server`.

Consequences:
- `@tangent/usage-ui-data` owns serializable Usage view models.
- `@tangent/usage-ui` owns Svelte components, app CSS, standalone assets, and an embedded module for `tangent ui`.
- `@tangent/ui-tokens` remains framework-free.
- The combined `@tangent/tangent-ui` shell loads product-owned embedded modules such as Usage, Trees, and Eval rather than importing product packages.

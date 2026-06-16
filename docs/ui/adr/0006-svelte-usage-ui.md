# ADR 0006: Svelte Usage UI

Decision: use Svelte, TypeScript, and Vite for `@tangent/usage-ui`.

Reason: Usage is now the only browser UI surface. A self-contained Svelte app keeps the local UI lightweight, removes the old shared React platform dependency chain, and preserves framework-agnostic server APIs through `@tangent/ui-server`.

Consequences:
- `@tangent/usage-ui-data` owns serializable Usage view models.
- `@tangent/usage-ui` owns Svelte components and app CSS.
- `@tangent/ui-tokens` remains framework-free.
- Eval, Rollup, and Trees browser UIs are retired until there is a concrete replacement need.

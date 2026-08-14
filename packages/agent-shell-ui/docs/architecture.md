# @tangent/agent-shell-ui Architecture

This Svelte package renders serializable data from `/api/work/*`. It does not read the vault, run Git, or start provider processes.

The embedded bundle mounts under `/apps/trees/`. The combined shell selects it through the `@tangent/agent-shell` app descriptor.

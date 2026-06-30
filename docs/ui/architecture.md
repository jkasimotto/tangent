# UI Architecture

The browser UI surface is the Svelte `@tangent/tangent-ui` shell plus product-owned embedded apps such as `@tangent/usage-ui` and `@tangent/eval-ui`. Domain packages expose serializable APIs and UI-data packages convert those APIs into stable view models.

Local servers are framework-agnostic: products register API routes and pass compiled or dev-capable UI assets into `@tangent/ui-server`. Shared UI code is limited to framework-free tokens and the combined shell; products own their Svelte components and CSS.

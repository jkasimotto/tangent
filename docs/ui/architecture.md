# UI Architecture

The browser UI surface is the Svelte `@tangent/usage-ui` app. Domain packages expose serializable APIs and UI-data packages convert those APIs into stable view models.

Local servers are framework-agnostic: products register API routes and pass compiled UI assets into `@tangent/ui-server`. Shared UI code is limited to framework-free tokens while the Usage app owns its Svelte components and CSS.

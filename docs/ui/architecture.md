# UI Architecture

Product-owned Svelte apps provide the browser surfaces. Examples are `@tangent/usage-ui` and `@tangent/eval-ui`. Each app server serves its own surface.

Domain packages expose serializable APIs. UI-data packages convert those APIs into stable view models. ADR-0019 removed the combined shell.

Local servers are framework-agnostic. Products register API routes and pass UI assets into `@tangent/ui-server`. Products own their Svelte components and CSS.

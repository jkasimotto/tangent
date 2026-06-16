# @tangent/tangent-ui Architecture

The Tangent UI shell is a Svelte app that fetches installed app descriptors from `/api/ui/apps`, renders compact top navigation, and mounts product-owned embedded UI modules.

Product packages own their UI bundles and API routes. The shell does not import product domains.

The shell chrome is part of normal Svelte layout, not an overlay on product apps. `ShellLayout.svelte` reserves a top chrome row for app switching and a `minmax(0, 1fr)` workspace for the active app host. Embedded apps should receive a stable parent-sized container and should not need to compensate for shell navigation.

# @tangent/tangent-ui Architecture

The Tangent UI shell is a Svelte app that fetches installed app descriptors from `/api/ui/apps`, renders compact top navigation, and mounts product-owned embedded UI modules.

Product packages own their UI bundles and API routes. The shell does not import product domains.

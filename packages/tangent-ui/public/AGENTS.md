# tangent-ui/public

Purpose: static PWA assets copied verbatim to the build root, so `tangent ui` can be installed as a standalone desktop window (own dock icon, out of the browser tab strip).

Contents:
- `manifest.webmanifest`: web app manifest (name, icons, standalone display, `/trees` start URL).
- `icon.svg`: app icon (a circle with a tangent line).
- `sw.js`: minimal service worker. Enables installability; deliberately does not cache (Tangent needs its local server, and caching hashed bundles would serve stale builds).

Read next:
- ../docs/index.md

Local rules:
- Keep this directory limited to files that must be served as-is at the site root. Anything that should be hashed or bundled belongs in `src/`.
- The service worker must stay non-caching.

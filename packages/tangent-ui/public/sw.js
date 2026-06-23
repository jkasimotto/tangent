// Minimal service worker: makes Tangent installable as a standalone PWA window.
// Deliberately does NOT cache: Tangent is a local-server UI (it is useless without
// the running server), and caching the hashed asset bundles would only serve stale
// builds after a rebuild. The empty fetch handler exists solely to satisfy install
// criteria; every request passes straight through to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass through to the network; no caching by design.
});

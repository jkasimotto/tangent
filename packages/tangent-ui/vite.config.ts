/// <reference types="vitest" />
import { rm } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/**
 * public/ holds the PWA runtime assets (manifest, icon, service worker), but it also carries the
 * governance-required AGENTS.md and its CLAUDE.md symlink. Vite copies public/ verbatim, so this
 * plugin strips those two docs from the build output; only the runtime assets should ship/serve.
 */
function dropPublicDocs(): Plugin {
  let outDir = "dist";
  return {
    name: "drop-public-docs",
    /** Captures the resolved output directory so closeBundle knows where to clean. */
    configResolved(config) { outDir = config.build.outDir; },
    /** Removes the AGENTS.md/CLAUDE.md copied from public/ once the bundle is written. */
    async closeBundle() {
      await Promise.all(["AGENTS.md", "CLAUDE.md"].map((file) => rm(path.resolve(outDir, file), { force: true })));
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [svelte(), dropPublicDocs()],
  resolve: {
    conditions: ["browser"]
  },
  test: {
    environment: "jsdom"
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // Content-hash the shell bundles so each build produces new filenames. index.html is served
      // `no-store` and the hashed assets `immutable`, so a reload (manual or the pwa-stale-version
      // auto-reload) always fetches the new entry instead of a stale immutable-cached `index.js`.
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

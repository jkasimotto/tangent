/// <reference types="vitest" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  base: "./",
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"]
  },
  test: {
    environment: "jsdom"
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});

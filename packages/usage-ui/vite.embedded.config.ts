import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"]
  },
  build: {
    outDir: "dist/embedded",
    emptyOutDir: true,
    lib: {
      entry: "src/embedded.ts",
      formats: ["es"],
      /** Names the embedded entry bundle. */
      fileName: () => "embedded.js",
      cssFileName: "embedded"
    },
    rollupOptions: {
      output: {
        assetFileNames: "[name][extname]",
        minifyInternalExports: false
      }
    }
  }
});

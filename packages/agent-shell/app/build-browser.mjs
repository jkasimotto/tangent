import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, "..", "dist", "browser");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: { "agent-shell-map": path.join(here, "map", "index.tsx") },
  outdir: output,
  bundle: true,
  splitting: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  conditions: ["production"],
  loader: { ".woff2": "file" },
  entryNames: "[name]",
  chunkNames: "agent-shell-map-assets/[name]-[hash]",
  assetNames: "agent-shell-map-assets/[name]-[hash]",
  legalComments: "none",
});

const excalidraw = path.dirname(fileURLToPath(import.meta.resolve("@excalidraw/excalidraw")));
const assets = path.join(output, "agent-shell-map-assets");
await mkdir(assets, { recursive: true });
await cp(path.join(excalidraw, "fonts"), path.join(assets, "fonts"), { recursive: true, force: true });
for (const file of ["subset-worker.chunk.js", "subset-shared.chunk.js"]) await cp(path.join(excalidraw, file), path.join(assets, file), { force: true });

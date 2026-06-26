import { fileURLToPath } from "node:url";

export const pipelineUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

export const pipelineUiEmbeddedAssets = {
  rootDir: fileURLToPath(new URL("embedded/", import.meta.url)),
  indexFile: "embedded.js"
};

import { fileURLToPath } from "node:url";

export const usageUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

export const usageUiEmbeddedAssets = {
  rootDir: fileURLToPath(new URL("embedded/", import.meta.url)),
  indexFile: "embedded.js"
};

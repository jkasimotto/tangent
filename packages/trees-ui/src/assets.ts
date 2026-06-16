import { fileURLToPath } from "node:url";

export const treesUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

export const treesUiEmbeddedAssets = {
  rootDir: fileURLToPath(new URL("embedded/", import.meta.url)),
  indexFile: "embedded.js"
};

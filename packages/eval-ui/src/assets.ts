import { fileURLToPath } from "node:url";

export const evalUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

export const evalUiEmbeddedAssets = {
  rootDir: fileURLToPath(new URL("embedded/", import.meta.url)),
  indexFile: "embedded.js"
};

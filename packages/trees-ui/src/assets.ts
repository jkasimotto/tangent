import { fileURLToPath } from "node:url";

export const treesUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

import { fileURLToPath } from "node:url";

export const rollupUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

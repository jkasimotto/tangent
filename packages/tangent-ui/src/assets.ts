import { fileURLToPath } from "node:url";

export const tangentUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

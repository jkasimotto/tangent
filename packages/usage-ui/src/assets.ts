import { fileURLToPath } from "node:url";

export const usageUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

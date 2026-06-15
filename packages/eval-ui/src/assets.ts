import { fileURLToPath } from "node:url";

export const evalUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

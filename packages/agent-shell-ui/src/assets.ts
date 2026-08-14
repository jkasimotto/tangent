import { fileURLToPath } from "node:url";

export const agentShellUiAssets = {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  indexFile: "index.html"
};

export const agentShellUiEmbeddedAssets = {
  rootDir: fileURLToPath(new URL("embedded/", import.meta.url)),
  indexFile: "embedded.js"
};

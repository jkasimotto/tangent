import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Builds the same browser module graph that shell.html loads. */
export async function browserBundle() {
  const result = await build({
    entryPoints: [path.join(here, "public", "shell.js")],
    bundle: true,
    external: ["/agent-shell-map.js"],
    format: "iife",
    globalName: "AgentShellTest",
    footer: { js: "Object.assign(globalThis, AgentShellTest);" },
    platform: "browser",
    write: false,
  });
  return result.outputFiles[0].text;
}

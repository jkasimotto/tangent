#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export { usageCommandSpec } from "./spec.js";
export { runUsageCli } from "./usage.js";

import { runUsageCli } from "./usage.js";

if (isDirectRun()) {
  runUsageCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}

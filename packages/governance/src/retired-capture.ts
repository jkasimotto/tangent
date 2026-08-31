import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/core";
import type { GovernanceFinding } from "./index.js";

/** Prevents removed capture storage and product language from returning. */
export async function lintRetiredCaptureVocabulary(root: string): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const codeRoots = ["packages/agent-shell/app", "packages/agent-shell/src", "src/cli"];
  const codeFiles = (await Promise.all(codeRoots.map((entry) => filesBelow(path.join(root, entry)))))
    .flat()
    .filter((file) => /\.(?:js|jsx|mjs|ts|tsx|md)$/.test(file))
    .filter((file) => !/\.test\.[^.]+$/.test(file))
    .filter((file) => !file.includes(`${path.sep}test-fixtures${path.sep}`));
  const currentDocs = [
    "AGENTS.md",
    "ARCHITECTURE.md",
    "docs/architecture/package-boundaries.md",
    "packages/agent-shell/AGENTS.md",
    "packages/agent-shell/README.md",
    "packages/agent-shell/docs/index.md",
    "packages/agent-shell/docs/architecture.md",
    "packages/agent-shell/docs/public-api.md",
    "packages/governance/docs/architecture.md",
    "packages/governance/docs/public-api.md",
  ].map((file) => path.join(root, file));
  const artifactRules = [
    /\/api\/areas\/journal/,
    /\/api\/ideas?\b/,
    /\b(?:route-journal|routed-journal)\b/,
    /\btangent idea\b/,
    /\bideas\.md\b/,
    /\bjournal(?:-[a-z0-9-]+)?\.md\b/i,
    /\/remember\b/,
    /\.agents\/skills\/remember\b/,
    /Ideas and open questions/,
    /\bkind\s*[:=]\s*["']idea["']/,
  ];
  const targets = [...new Set([...codeFiles, ...currentDocs])];
  for (const file of targets) {
    if (!await pathExists(file)) continue;
    const text = await readFile(file, "utf8");
    for (const pattern of artifactRules) {
      if (!pattern.test(text)) continue;
      findings.push(finding(root, file, `contains retired capture artifact ${pattern}.`));
    }
  }
  for (const file of currentDocs) {
    if (!await pathExists(file)) continue;
    const text = await readFile(file, "utf8");
    if (/\b(?:Journal|Ideas|Threads)\b/.test(text)) {
      findings.push(finding(root, file, "uses a retired product noun in current architecture or instructions."));
    }
  }
  return findings;
}

/** Lists regular files below one governed root. */
async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

/** Creates one readable finding. */
function finding(root: string, file: string, message: string): GovernanceFinding {
  return {
    rule: "agent-shell/retired-capture-vocabulary",
    severity: "error",
    file: path.relative(root, file).split(path.sep).join("/"),
    message,
    fix: [
      "Remove the retired storage, route, command, schema value, or product noun.",
      "Send durable Area messages through POST /api/agents/send and the existing Area inbox.",
      "Keep historical decisions and technical database or runtime terms outside current product instructions.",
    ],
  };
}

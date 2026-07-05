import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { pathExists, type CliCommandSpec } from "@tangent/core";
import {
  findFiles,
  hasGroup,
  importSpecifiers,
  isTangentPackage,
  ownerPackage,
  packageInfos,
  relative,
  requireFile,
  sourceFiles,
  tangentPackageName,
  walkDirs,
  type PackageInfo
} from "./walk.js";
import { lintPackageInstallability, packageDependencyInfos } from "./package-installability.js";

export type GovernanceLintGroup = "all" | "docs" | "deps" | "agents" | "shared" | "hooks" | "files";

export type GovernanceLintOptions = {
  root?: string;
  groups?: GovernanceLintGroup[];
};

export type GovernanceFinding = {
  rule: string;
  severity: "error" | "warning";
  file?: string;
  message: string;
  fix: string[];
};

export type GovernanceLintResult = {
  findings: GovernanceFinding[];
  errors: number;
  warnings: number;
};

export const governanceCommandSpec: CliCommandSpec = {
  name: "governance",
  description: "Run Tangent architecture, dependency, docs, and agent-legibility lints",
  subcommands: [
    {
      name: "lint",
      description: "Run governance lints",
      args: "[docs|deps|agents|shared|hooks|files]"
    }
  ]
};

const allowedPackageDeps: Record<string, string[]> = {
  "tangent": [
    "@tangent/core",
    "@tangent/launcher",
    "@tangent/ui-server",
    "@tangent/tangent-ui"
  ],
  "@tangent/core": [],
  "@tangent/repo": ["@tangent/core"],
  "@tangent/agent-runtime": ["@tangent/core"],
  "@tangent/governance": ["@tangent/core", "@tangent/repo"],
  "@tangent/usage-schema": [],
  "@tangent/usage-core": ["@tangent/core", "@tangent/repo", "@tangent/usage-schema"],
  "@tangent/usage-index-sqlite": ["@tangent/repo", "@tangent/usage-core", "@tangent/usage-schema", "@tangent/usage-providers"],
  "@tangent/usage-providers": ["@tangent/repo", "@tangent/usage-core", "@tangent/usage-schema"],
  "@tangent/usage": ["@tangent/core", "@tangent/repo", "@tangent/ui-server", "@tangent/usage-core", "@tangent/usage-index-sqlite", "@tangent/usage-providers", "@tangent/usage-ui", "@tangent/usage-ui-data"],
  "@tangent/ui-tokens": [],
  "@tangent/ui-server": ["@tangent/core"],
  "@tangent/tangent-ui": ["@tangent/ui-tokens"],
  "@tangent/usage-ui-data": [],
  "@tangent/usage-ui": ["@tangent/usage-ui-data", "@tangent/ui-tokens"],
  "@tangent/eval-ui": ["@tangent/ui-tokens"],
  "@tangent/rollup": ["@tangent/core", "@tangent/repo", "@tangent/agent-runtime", "@tangent/usage-index-sqlite"],
  "@tangent/eval": ["@tangent/core", "@tangent/repo", "@tangent/agent-runtime", "@tangent/usage-core", "@tangent/usage-index-sqlite", "@tangent/ui-server", "@tangent/eval-ui"],
  "@tangent/launcher": ["@tangent/core"],
  "@tangent/search": ["@tangent/core", "@tangent/repo"]
};

/** Supports the lint governance helper. */
export async function lintGovernance(options: GovernanceLintOptions = {}): Promise<GovernanceLintResult> {
  const root = path.resolve(options.root || process.cwd());
  const groups: Set<GovernanceLintGroup> = new Set(options.groups?.length ? options.groups : ["all"]);
  const findings: GovernanceFinding[] = [];
  const ctx = { root, packages: await packageInfos(root) };

  if (hasGroup(groups, "agents") || hasGroup(groups, "docs")) findings.push(...await lintAgentDocs(ctx));
  if (hasGroup(groups, "deps")) findings.push(...await lintPackageDeps(ctx), ...await lintPackageInstallability(ctx), ...await lintImports(ctx), ...await lintUsageDependencyLightEntrypoints(ctx), ...await lintUiPackageBoundaries(ctx));
  if (hasGroup(groups, "shared")) findings.push(...await lintSharedHelpers(ctx));
  if (hasGroup(groups, "hooks")) findings.push(...await lintHookBoundaries(ctx));
  if (hasGroup(groups, "files")) findings.push(...await lintFileSizes(ctx));

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  return { findings, errors, warnings };
}

/** Supports the render governance findings helper. */
export function renderGovernanceFindings(result: GovernanceLintResult): string {
  if (!result.findings.length) return "governance lint passed";
  return result.findings.map((finding) => {
    const header = `${finding.rule}: ${finding.file ? `${finding.file}: ` : ""}${finding.message}`;
    const fix = finding.fix.length ? `\nFix:\n${finding.fix.map((step, index) => `  ${index + 1}. ${step}`).join("\n")}` : "";
    return `${header}${fix}`;
  }).join("\n\n");
}

type LintContext = {
  root: string;
  packages: PackageInfo[];
};

/** Supports the lint agent docs helper. */
async function lintAgentDocs(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const requiredAgentDirs = new Map<string, string[]>();
  // `.claude/worktrees` is the gitignored mount point for throwaway dev worktrees (full checkouts);
  // it is not source to document, so do not require agent docs inside it.
  const worktreeMount = `${path.sep}.claude${path.sep}worktrees`;
  for (const dir of await walkDirs(ctx.root)) {
    if (dir.includes(worktreeMount)) continue;
    requiredAgentDirs.set(dir, [
      "Create AGENTS.md in this folder with purpose, local rules, and read-next links.",
      "Add a sibling CLAUDE.md symlink that points to AGENTS.md."
    ]);
  }
  requiredAgentDirs.set(ctx.root, [
    "Create a short root AGENTS.md table of contents.",
    "Link to ARCHITECTURE.md, docs/index.md, and validation commands."
  ]);
  await requireFile(findings, ctx.root, "ARCHITECTURE.md", "agent-docs/required", [
    "Create ARCHITECTURE.md as the stable architecture entrypoint.",
    "Keep details in docs/architecture/*.md."
  ]);
  await requireFile(findings, ctx.root, "docs/index.md", "agent-docs/required", [
    "Create docs/index.md and point to architecture, agent, and quality docs.",
    "Use it as the system-of-record map for future agents."
  ]);

  for (const pkg of ctx.packages) {
    requiredAgentDirs.set(pkg.dir, [
      "Create packages/<pkg>/AGENTS.md with package purpose, local rules, and docs links.",
      "Keep detailed architecture notes in packages/<pkg>/docs/."
    ]);
    await requireFile(findings, pkg.dir, "docs/index.md", "agent-docs/required", [
      "Create packages/<pkg>/docs/index.md.",
      "Link package architecture and public API notes from that index."
    ]);
    await requireFile(findings, pkg.dir, "docs/architecture.md", "agent-docs/required", [
      "Create packages/<pkg>/docs/architecture.md.",
      "Describe package responsibilities and forbidden dependencies."
    ]);
    await requireFile(findings, pkg.dir, "docs/public-api.md", "agent-docs/required", [
      "Create packages/<pkg>/docs/public-api.md.",
      "Document public entrypoints agents may import."
    ]);

    const srcDir = path.join(pkg.dir, "src");
    if (await pathExists(srcDir)) {
      for (const dir of await walkDirs(srcDir)) {
        requiredAgentDirs.set(dir, [
          "Add a short AGENTS.md to this source directory.",
          "State the directory purpose and point back to package docs."
        ]);
      }
    }
  }

  const pairedAgentDirs = new Set(requiredAgentDirs.keys());
  for (const agentFile of await findFiles(ctx.root, "AGENTS.md")) pairedAgentDirs.add(path.dirname(agentFile));
  for (const claudeFile of await findFiles(ctx.root, "CLAUDE.md")) pairedAgentDirs.add(path.dirname(claudeFile));
  for (const dir of [...pairedAgentDirs].sort((a, b) => relative(ctx.root, a).localeCompare(relative(ctx.root, b)))) {
    await requireAgentDocPair(findings, ctx, dir, requiredAgentDirs.get(dir));
  }

  for (const agentFile of await findFiles(ctx.root, "AGENTS.md")) {
    const rel = relative(ctx.root, agentFile);
    const lines = (await readFile(agentFile, "utf8")).split(/\r?\n/);
    const limit = rel === "AGENTS.md" ? 100 : 60;
    if (lines.length > limit) {
      findings.push({
        rule: "agent-docs/short",
        severity: "error",
        file: rel,
        message: `AGENTS.md is ${lines.length} lines; limit is ${limit}.`,
        fix: [
          "Move detailed guidance into docs/.",
          "Leave only purpose, local rules, read-next links, and validation commands."
        ]
      });
    }
    const text = lines.join("\n");
    if (!/docs\/index\.md|No package docs/.test(text)) {
      findings.push({
        rule: "agent-docs/links",
        severity: "error",
        file: rel,
        message: "AGENTS.md does not link to a docs/index.md or explain why none exists.",
        fix: [
          "Add a Read next section that links to the nearest docs/index.md.",
          "If no docs are appropriate, state the reason explicitly."
        ]
      });
    }
  }

  return findings;
}

/** Supports the agent instruction file pair lint. */
async function requireAgentDocPair(findings: GovernanceFinding[], ctx: LintContext, dir: string, agentFix?: string[]): Promise<void> {
  const agentPath = path.join(dir, "AGENTS.md");
  const claudePath = path.join(dir, "CLAUDE.md");
  const relAgent = relative(ctx.root, agentPath);
  const relClaude = relative(ctx.root, claudePath);
  const hasAgent = await pathExists(agentPath);
  if (!hasAgent) {
    findings.push({
      rule: "agent-docs/required",
      severity: "error",
      file: relAgent,
      message: "required AGENTS.md file is missing.",
      fix: agentFix || [
        "Create AGENTS.md in this folder with purpose, local rules, and read-next links.",
        "Add a sibling CLAUDE.md symlink that points to AGENTS.md."
      ]
    });
    return;
  }

  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(claudePath);
  } catch {
    findings.push({
      rule: "agent-docs/claude-symlink",
      severity: "error",
      file: relClaude,
      message: "CLAUDE.md symlink is missing for AGENTS.md.",
      fix: [`Run: ln -s AGENTS.md ${relClaude}`]
    });
    return;
  }

  if (!stats.isSymbolicLink()) {
    findings.push({
      rule: "agent-docs/claude-symlink",
      severity: "error",
      file: relClaude,
      message: "CLAUDE.md must be a symlink to sibling AGENTS.md.",
      fix: [
        `Remove ${relClaude}.`,
        `Run: ln -s AGENTS.md ${relClaude}`
      ]
    });
    return;
  }

  const target = await readlink(claudePath);
  if (path.resolve(dir, target) !== agentPath) {
    findings.push({
      rule: "agent-docs/claude-symlink",
      severity: "error",
      file: relClaude,
      message: `CLAUDE.md points to ${target}; expected AGENTS.md.`,
      fix: [
        `Remove ${relClaude}.`,
        `Run: ln -s AGENTS.md ${relClaude}`
      ]
    });
  }
}

/** Supports the lint package deps helper. */
async function lintPackageDeps(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const pkg of await packageDependencyInfos(ctx)) {
    const allowed = new Set(allowedPackageDeps[pkg.name] || []);
    const deps = Object.keys(pkg.manifest.dependencies || {}).filter((dep) => isTangentPackage(dep));
    for (const dep of deps) {
      if (!allowed.has(dep)) {
        findings.push({
          rule: "deps/package-boundaries",
          severity: "error",
          file: relative(ctx.root, pkg.packageJsonPath),
          message: `${pkg.name} depends on ${dep}, which is not in the allowed dependency graph.`,
          fix: [
            "Open docs/architecture/package-boundaries.md.",
            "Move shared code to an allowed platform package or update the documented graph and this lint together.",
            "Do not add a vertical app dependency unless it is explicitly allowed."
          ]
        });
      }
    }
  }
  return findings;
}

/** Supports the lint imports helper. */
async function lintImports(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const packageByDir = new Map(ctx.packages.map((pkg) => [pkg.dir, pkg]));
  for (const file of await sourceFiles(ctx.root)) {
    const owner = ownerPackage(file, ctx.packages);
    if (!owner) continue;
    const text = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(text)) {
      const importedPackage = tangentPackageName(specifier);
      if (!importedPackage) continue;
      if (/\/(src|dist)\//.test(specifier)) {
        findings.push({
          rule: "deps/no-internal-cross-package-imports",
          severity: "error",
          file: relative(ctx.root, file),
          message: `${specifier} imports another package's internal files.`,
          fix: [
            "Import from the package public entrypoint or an exported subpath.",
            "If the symbol is not public, add it to that package's exports and docs/public-api.md."
          ]
        });
      }
      const allowed = new Set(allowedPackageDeps[owner.name] || []);
      if (importedPackage !== owner.name && packageByDir.size && !allowed.has(importedPackage)) {
        findings.push({
          rule: "deps/no-vertical-backedges",
          severity: "error",
          file: relative(ctx.root, file),
          message: `${owner.name} imports ${importedPackage}, which violates package boundaries.`,
          fix: [
            "Move shared behavior to core, repo, or agent-runtime.",
            "Keep vertical apps independent except rollup/eval -> usage.",
            "Update docs/architecture/dependency-graph.md only with an intentional graph change."
          ]
        });
      }
    }
  }
  return findings;
}

/** Supports the lint usage dependency light entrypoints helper. */
async function lintUsageDependencyLightEntrypoints(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const file of await sourceFiles(ctx.root)) {
    const rel = relative(ctx.root, file);
    if (!rel.startsWith("packages/usage/src/")) continue;
    const text = await readFile(file, "utf8");
    const isDependencyLight = rel.startsWith("packages/usage/src/schema/") ||
      rel.startsWith("packages/usage/src/core/") ||
      rel.startsWith("packages/usage/src/query/");
    if (isDependencyLight && /from\s+["']better-sqlite3["']|import\s+["']better-sqlite3["']/.test(text)) {
      findings.push({
        rule: "deps/usage-core-no-static-sqlite",
        severity: "error",
        file: rel,
        message: "dependency-light usage entrypoints must not statically import better-sqlite3.",
        fix: [
          "Move SQLite behavior behind @tangent/usage/sqlite or a lazy compatibility boundary.",
          "Keep @tangent/usage/schema, /core, and /query importable without optional native dependencies."
        ]
      });
    }
    if (isDependencyLight && /from\s+["']\.\.\/pricing|from\s+["'].*\/pricing/.test(text)) {
      findings.push({
        rule: "deps/usage-core-no-pricing",
        severity: "error",
        file: rel,
        message: "dependency-light usage entrypoints must not import pricing code.",
        fix: [
          "Keep pricing behind @tangent/usage/pricing.",
          "Pass priced cost data into core as ordinary UsageCost metrics."
        ]
      });
    }
  }
  return findings;
}

/** Supports the lint ui package boundaries helper. */
async function lintUiPackageBoundaries(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const productPackages = new Set(["@tangent/usage", "@tangent/eval", "@tangent/rollup", "@tangent/search"]);
  const apiOnlyPackages = new Set(["@tangent/usage-schema", "@tangent/usage-core"]);
  for (const file of await sourceFiles(ctx.root)) {
    const owner = ownerPackage(file, ctx.packages);
    if (!owner) continue;
    const rel = relative(ctx.root, file);
    const text = await readFile(file, "utf8");
    const imports = importSpecifiers(text).map(tangentPackageName).filter((value): value is string => Boolean(value));

    if (apiOnlyPackages.has(owner.name)) {
      const forbidden = imports.find((specifier) => specifier.startsWith("@tangent/ui-") || specifier === "@tangent/usage-index-sqlite" || specifier === "@tangent/usage-providers");
      if (forbidden) {
        findings.push({
          rule: "deps/api-only-no-ui-sqlite-provider",
          severity: "error",
          file: rel,
          message: `${owner.name} imports ${forbidden}, but API-only usage packages must stay UI/SQLite/provider free.`,
          fix: [
            "Move UI mapping to usage-ui-data or usage-ui.",
            "Move SQLite behavior to usage-index-sqlite.",
            "Move provider-native parsing to usage-providers."
          ]
        });
      }
    }

    if (owner.name.startsWith("@tangent/ui-") && owner.name !== "@tangent/ui-docs") {
      const forbidden = imports.find((specifier) => productPackages.has(specifier));
      if (forbidden) {
        findings.push({
          rule: "deps/ui-no-product-imports",
          severity: "error",
          file: rel,
          message: `${owner.name} imports product package ${forbidden}.`,
          fix: [
            "Move domain mapping into a product ui-data package.",
            "Pass generic serializable view models into UI packages."
          ]
        });
      }
    }
  }
  return findings;
}

/** Supports the lint shared helpers helper. */
async function lintSharedHelpers(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const file of await sourceFiles(ctx.root)) {
    const rel = relative(ctx.root, file);
    if (rel.startsWith("packages/governance/")) continue;
    const text = await readFile(file, "utf8");
    if (!rel.startsWith("packages/core/") && /export function parseArgs\b/.test(text)) {
      findings.push({
        rule: "shared/no-local-parse-args",
        severity: "error",
        file: rel,
        message: "defines parseArgs outside @tangent/core.",
        fix: [
          "Use parseArgs from @tangent/core/cli.",
          "Move missing repeatable or inline-value behavior into packages/core/src/cli/args.ts.",
          "Delete the local parser."
        ]
      });
    }
    if (!rel.startsWith("packages/agent-runtime/") && /export async function runProcess\b/.test(text)) {
      findings.push({
        rule: "shared/no-local-process-runner",
        severity: "error",
        file: rel,
        message: "defines runProcess outside @tangent/agent-runtime.",
        fix: [
          "Use runProcess from @tangent/agent-runtime/process.",
          "Move missing cwd/env/timeout behavior into packages/agent-runtime/src/process.ts.",
          "Delete the local process wrapper."
        ]
      });
    }
    if (!rel.startsWith("packages/repo/") && /export async function (findGitRoot|findRepoRoot|resolveRepo|repoInfo)\b/.test(text)) {
      findings.push({
        rule: "shared/no-local-repo-discovery",
        severity: "error",
        file: rel,
        message: "defines repo discovery outside @tangent/repo.",
        fix: [
          "Use @tangent/repo discover helpers.",
          "Keep app-specific output path construction in the app package.",
          "Delete the local repo discovery wrapper."
        ]
      });
    }
  }
  return findings;
}

/** Supports the lint hook boundaries helper. */
async function lintHookBoundaries(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const providerHookPattern = /@tangent\/hooks|hook-runner|usage hook record|usage hooks install|installHooks\b|uninstallHooks\b|recordHook\b/;
  for (const file of await sourceFiles(ctx.root)) {
    const rel = relative(ctx.root, file);
    if (rel.startsWith("packages/governance/")) continue;
    const text = await readFile(file, "utf8");
    if (providerHookPattern.test(text)) {
      findings.push({
        rule: "hooks/no-hook-capture-product-surface",
        severity: "error",
        file: rel,
        message: "contains deprecated hook install or record product surface.",
        fix: [
          "Keep native transcript indexing as the usage source of truth.",
          "Preserve old usage-jsonl parsing only for historical data.",
          "Do not reintroduce hook install, hook record, or @tangent/hooks dependencies."
        ]
      });
    }
  }
  return findings;
}

/** Supports the lint file sizes helper. */
async function lintFileSizes(ctx: LintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const file of await sourceFiles(ctx.root)) {
    const rel = relative(ctx.root, file);
    if (/\.generated\.|\/dist\//.test(rel)) continue;
    const lineCount = (await readFile(file, "utf8")).split(/\r?\n/).length;
    if (lineCount > 700) {
      findings.push({
        rule: "files/max-size",
        severity: "error",
        file: rel,
        message: `${lineCount} lines exceeds the 700-line hard limit.`,
        fix: [
          "Split cohesive logic into smaller files.",
          "If generated, add a generated filename marker or allowlist entry.",
          "Update docs/quality/tech-debt.md only for intentional temporary exceptions."
        ]
      });
    } else if (lineCount > 400) {
      findings.push({
        rule: "files/max-size",
        severity: "warning",
        file: rel,
        message: `${lineCount} lines exceeds the 400-line warning threshold.`,
        fix: [
          "Consider splitting this file by responsibility.",
          "Leave it as-is only when the local structure is still easy to scan."
        ]
      });
    }
  }
  return findings;
}

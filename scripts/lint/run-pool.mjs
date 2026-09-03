#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, readSync, closeSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs every lint under scripts/lint/ plus the docstring lint as a bounded pool, then jscpd in
// blocking mode over the strict Map scope. Lints are discovered at run time so a new lint joins
// the pool the moment its file lands. A lint is a top-level scripts/lint/*.mjs that opens with a
// node shebang; shared helper modules there have none and are never run. `npm run lint` runs this
// over the whole tree and the pre-commit hook runs it with --staged.

const POOL_SIZE = Math.min(8, availableParallelism());
const LINT_DIR = "scripts/lint";
const DOCSTRING_LINT = "scripts/lint-function-docstrings.mjs";
const JSCPD_CONFIG = ".jscpd.json";
const STRICT_SCOPE_PREFIXES = ["packages/agent-shell/app/map/", "scripts/lint/"];
const NODE_SHEBANG = "#!/usr/bin/env node";
const OWN_BASENAME = path.basename(fileURLToPath(import.meta.url));
const TOOLING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Parses the pool's own flags and keeps every other argument for the lints. */
function parseArgs(argv) {
  const parsed = { root: process.cwd(), staged: false, passthrough: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      parsed.root = path.resolve(argv[index + 1] ?? ".");
      index += 1;
      continue;
    }
    if (arg === "--staged") parsed.staged = true;
    parsed.passthrough.push(arg);
  }
  return parsed;
}

/** Returns whether the pool was given explicit paths rather than a scope flag. */
function hasExplicitPaths(passthrough) {
  return passthrough.some((arg) => !arg.startsWith("--"));
}

/** Returns whether a file opens with a node shebang, which marks a runnable lint rather than a shared helper. */
function hasNodeShebang(filePath) {
  const buffer = Buffer.alloc(NODE_SHEBANG.length);
  const fd = openSync(filePath, "r");
  try {
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, read) === NODE_SHEBANG;
  } finally {
    closeSync(fd);
  }
}

/** Lists the lint scripts under scripts/lint/: shebang files, skipping tests, helpers and this runner. */
function discoverLints(root) {
  const dir = path.join(root, LINT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs") && name !== OWN_BASENAME)
    .filter((name) => hasNodeShebang(path.join(dir, name)))
    .sort()
    .map((name) => ({ name: name.replace(/\.mjs$/, ""), script: path.join(LINT_DIR, name) }));
}

/** Builds the argument list for the docstring lint, which lints staged files unless told --all. */
function docstringLintArgs(parsed) {
  if (parsed.staged || hasExplicitPaths(parsed.passthrough)) return parsed.passthrough;
  return ["--all", ...parsed.passthrough];
}

/** Builds every lint job: the discovered lints, then the docstring lint. */
function buildLintJobs(parsed) {
  const jobs = discoverLints(parsed.root).map((lint) => ({
    name: lint.name,
    command: process.execPath,
    args: [path.join(parsed.root, lint.script), ...parsed.passthrough]
  }));
  const docstringPath = path.join(parsed.root, DOCSTRING_LINT);
  if (existsSync(docstringPath)) {
    jobs.push({ name: "function-docstrings", command: process.execPath, args: [docstringPath, ...docstringLintArgs(parsed)] });
  } else {
    jobs.push({ name: "function-docstrings", missing: DOCSTRING_LINT });
  }
  return jobs;
}

/** Lists staged paths, relative to the root, from the git index. */
function stagedPaths(root) {
  return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Returns whether a repo-relative path is a production file in the strict scope. */
function isStrictScopeSource(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (/\.test\./.test(path.basename(normalized))) return false;
  return STRICT_SCOPE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Decides whether jscpd runs: always, except a staged run that touches nothing in the strict scope. */
function shouldRunJscpd(parsed) {
  if (!parsed.staged) return true;
  return stagedPaths(parsed.root).some(isStrictScopeSource);
}

/** Builds the blocking jscpd job over the strict scope, using the config at the root. */
function buildJscpdJob(root) {
  const binary = path.join(TOOLING_ROOT, "node_modules", ".bin", "jscpd");
  return { name: "jscpd", command: binary, args: ["--config", path.join(root, JSCPD_CONFIG), "--no-colors"] };
}

/** Runs one job to completion, capturing its output so the pool can print it whole. */
function runJob(job, root) {
  if (job.missing) {
    return Promise.resolve({ name: job.name, code: 1, output: `${job.missing} is missing; the pool cannot run the docstring lint.\n` });
  }
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn(job.command, job.args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    /** Collects one chunk of child output. */
    const collect = (chunk) => chunks.push(chunk);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("close", (code) => resolve({ name: job.name, code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") }));
    child.on("error", (error) => resolve({ name: job.name, code: 1, output: `${job.name}: ${error.message}\n` }));
  });
}

/** Prints one finished job's output, labelled so a reader can tell which lint spoke. */
function printResult(result) {
  const text = result.output.trim();
  if (text.length === 0) {
    process.stdout.write(`${result.name}: ${result.code === 0 ? "passed" : "failed with no output"}\n`);
    return;
  }
  process.stdout.write(`${text}\n`);
}

/** Runs jobs through a fixed-size pool, printing each as it finishes, and returns the results. */
async function runPool(jobs, root) {
  const results = [];
  let next = 0;
  /** Pulls the next job until the queue is empty. */
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      const result = await runJob(job, root);
      printResult(result);
      results.push(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, jobs.length) }, worker));
  return results;
}

/** Runs the lint pool, then jscpd, and exits 1 if anything failed. */
async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const jobs = buildLintJobs(parsed);
  if (shouldRunJscpd(parsed)) jobs.push(buildJscpdJob(parsed.root));
  else process.stdout.write("jscpd: skipped, nothing staged in the strict scope\n");

  const results = await runPool(jobs, parsed.root);
  const failed = results.filter((result) => result.code !== 0).map((result) => result.name);
  const passed = results.length - failed.length;
  if (failed.length > 0) {
    process.stderr.write(`lint pool: ${passed} passed, ${failed.length} failed: ${failed.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`lint pool passed: ${passed} checks\n`);
}

await main();

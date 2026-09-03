import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const LINT = fileURLToPath(new URL("./function-size.mjs", import.meta.url));
const OWNER_DIRECTORY = "packages/agent-shell/app/map/ui";
const WIDER_DIRECTORY = "packages/agent-shell/app";

/** Writes one fixture at a repo-relative path under a fresh temporary root and returns that root. */
function fixtureRoot(files) {
  const root = mkdtempSync(path.join(tmpdir(), "function-size-"));
  for (const [repoPath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, repoPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }
  return root;
}

/** Runs the lint against a root with explicit paths and returns its exit status and output. */
function runLint(root, paths) {
  try {
    const stdout = execFileSync(process.execPath, [LINT, "--root", root, ...paths], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** Builds a documented function whose signature-to-brace span is exactly the given number of lines. */
function functionOfLines(name, lines) {
  const body = Array.from({ length: lines - 2 }, (_, index) => `  const step${index} = ${index};`);
  return `/** A fixture function. */\nexport function ${name}() {\n${body.join("\n")}\n}\n`;
}

test("a function of exactly 80 lines passes", () => {
  const repoPath = `${OWNER_DIRECTORY}/fits.ts`;
  const root = fixtureRoot({ [repoPath]: functionOfLines("fits", 80) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /function-size lint passed/);
});

test("a function of 81 lines fails at its signature line, docstring not counted", () => {
  const repoPath = `${OWNER_DIRECTORY}/too-long.ts`;
  const root = fixtureRoot({ [repoPath]: functionOfLines("tooLong", 81) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, new RegExp(`^${repoPath}:2  tooLong is 81 lines \\(max 80\\)$`, "m"));
});

test("an oversized arrow in a .jsx file in the wider scope fails when it is not grandfathered", () => {
  const repoPath = `${WIDER_DIRECTORY}/browser/fixture-panel.jsx`;
  const body = Array.from({ length: 80 }, (_, index) => `  const step${index} = <div>{${index}}</div>;`);
  const source = `/** A fixture component. */\nexport const Panel = () => {\n${body.join("\n")}\n  return null;\n};\n`;
  const root = fixtureRoot({ [repoPath]: source });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, new RegExp(`^${repoPath}:2  Panel is 83 lines \\(max 80\\)$`, "m"));
});

test("a test file is not a production module and is skipped", () => {
  const repoPath = `${OWNER_DIRECTORY}/skipped.test.ts`;
  const root = fixtureRoot({ [repoPath]: functionOfLines("skipped", 200) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /0 file\(s\) checked/);
});

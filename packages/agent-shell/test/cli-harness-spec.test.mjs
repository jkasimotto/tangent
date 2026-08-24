import assert from "node:assert/strict";
import test from "node:test";

import { harnessCommandSpec, runHarnessCli } from "../dist/cli/index.js";

test("tangent harness list has authoritative Area and JSON options", () => {
  assert.equal(harnessCommandSpec.name, "harness");
  assert.deepEqual(harnessCommandSpec.subcommands.map((entry) => entry.name), ["list"]);
  assert.deepEqual(harnessCommandSpec.subcommands[0].options.map((entry) => entry.name), ["area", "server", "json"]);
});

test("tangent harness help comes from the exported command specification", async () => {
  const printed = [];
  const previousLog = console.log;
  console.log = (...parts) => printed.push(parts.join(" "));
  try {
    await runHarnessCli(["--help"]);
  } finally {
    console.log = previousLog;
  }
  const output = printed.join("\n");
  assert.match(output, /list/);
  assert.match(output, /--area/);
  assert.match(output, /tangent harness list --area otto\/tangent --json/);
});

test("tangent harness list reports resolved defaults and exact model-specific effort commands", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const printed = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/tree") return Response.json({ areas: [{ path: "otto/tangent", children: [] }] });
    if (url.pathname === "/api/launch/options") return Response.json({
      source: "/tmp/trees/harnesses.md",
      area: "otto/tangent",
      workDefault: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model gpt-sol -c effort=low" },
      brainDefault: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model gpt-sol -c effort=low" },
      harnesses: [{
        id: "codex", label: "Codex", command: "codex", efforts: [],
        models: [{
          id: "sol", label: "Sol", args: "--model gpt-sol", command: "codex --model gpt-sol",
          efforts: [{ id: "ultra", label: "Ultra", args: "-c effort=ultra", command: "codex --model gpt-sol -c effort=ultra" }],
        }],
      }],
    });
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  console.log = (...parts) => printed.push(parts.join(" "));
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runHarnessCli(["list", "--area", "otto/tangent"]);
  const output = printed.join("\n");
  assert.match(output, /source: \/tmp\/trees\/harnesses\.md/);
  assert.match(output, /work default: codex\/sol\/low/);
  assert.match(output, /brain default: codex\/sol\/low/);
  assert.match(output, /sol\/ultra: codex --model gpt-sol -c effort=ultra/);
});

test("tangent harness list preserves the server catalog as JSON", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const printed = [];
  const catalog = { source: "/tmp/trees/harnesses.md", harnesses: [{ id: "codex", label: "Codex", command: "codex", models: [], efforts: [] }] };
  globalThis.fetch = async () => Response.json(catalog);
  console.log = (...parts) => printed.push(parts.join(" "));
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runHarnessCli(["list", "--json"]);
  assert.deepEqual(JSON.parse(printed.join("\n")), catalog);
});

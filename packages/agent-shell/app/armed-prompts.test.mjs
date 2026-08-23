import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ARMED_PROMPT_SCHEMA, armedPromptPath, clearArmedPrompt, readAllArmedPrompts, writeArmedPrompt } from "./armed-prompts.mjs";

/** A temporary armed-prompts root that the test removes afterwards. */
async function tempRoot(context) {
  const root = await mkdtemp(path.join(tmpdir(), "armed-prompts-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("an armed prompt is written to disk and reads back", async (context) => {
  const root = await tempRoot(context);
  const written = await writeArmedPrompt(root, "otto--tangent--goal--s2", {
    phase: "execute",
    submit: true,
    document: "",
    prompt: "Step 1 of 2: implement the Goal.",
    extraFiles: [],
  });
  assert.equal(written.schema, ARMED_PROMPT_SCHEMA);
  assert.equal(written.session, "otto--tangent--goal--s2");

  const [record] = await readAllArmedPrompts(root);
  assert.equal(record.session, "otto--tangent--goal--s2");
  assert.equal(record.prompt, "Step 1 of 2: implement the Goal.");
  assert.equal(record.submit, true);

  const raw = JSON.parse(await readFile(armedPromptPath(root, "otto--tangent--goal--s2"), "utf8"));
  assert.equal(raw.session, "otto--tangent--goal--s2");
});

test("clearing an armed prompt removes it; clearing a missing one is not an error", async (context) => {
  const root = await tempRoot(context);
  await writeArmedPrompt(root, "step-a", { phase: "execute", submit: false, document: "", prompt: "go", extraFiles: [] });
  await writeArmedPrompt(root, "step-b", { phase: "execute", submit: false, document: "", prompt: "go too", extraFiles: [] });

  await clearArmedPrompt(root, "step-a");
  const remaining = await readAllArmedPrompts(root);
  assert.deepEqual(remaining.map((record) => record.session), ["step-b"]);

  await clearArmedPrompt(root, "step-a"); // already gone: still not an error
});

test("a missing root reads as no armed prompts", async (context) => {
  const root = path.join(await tempRoot(context), "never-created");
  assert.deepEqual(await readAllArmedPrompts(root), []);
});

test("a half-written or foreign file is skipped, not thrown", async (context) => {
  const root = await tempRoot(context);
  await writeArmedPrompt(root, "good", { phase: "execute", submit: false, document: "", prompt: "go", extraFiles: [] });
  await writeFile(path.join(root, "broken.json"), "{ not json", "utf8");
  await writeFile(path.join(root, "foreign.json"), JSON.stringify({ schema: "something-else", session: "x" }), "utf8");

  const records = await readAllArmedPrompts(root);
  assert.deepEqual(records.map((record) => record.session), ["good"]);
});

test("a re-armed prompt overwrites the earlier record for the same session", async (context) => {
  const root = await tempRoot(context);
  await writeArmedPrompt(root, "step-a", { phase: "execute", submit: false, document: "", prompt: "first", extraFiles: [] });
  await writeArmedPrompt(root, "step-a", { phase: "execute", submit: true, document: "", prompt: "second", extraFiles: [] });

  const records = await readAllArmedPrompts(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].prompt, "second");
  assert.equal(records[0].submit, true);
});

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEvalSpec, resolveCriterionPoints } from "../dist/core/config.js";

/** Writes a spec object to a temp directory and returns the path to eval.json. */
async function specFile(spec) {
  const dir = await mkdtemp(path.join(tmpdir(), "eval-spec-"));
  const file = path.join(dir, "eval.json");
  await writeFile(file, JSON.stringify(spec), "utf8");
  await writeFile(path.join(dir, "p.md"), "do it", "utf8");
  return file;
}
const base = {
  schema: "eval.spec.v1", name: "x",
  cases: [{ id: "c", variants: [{ id: "v", prompt: "p.md", repo: { path: ".", ref: "HEAD" } }] }]
};

test("resolveCriterionPoints defaults to 1", () => {
  assert.equal(resolveCriterionPoints(undefined), 1);
  assert.equal(resolveCriterionPoints(3), 3);
});

test("evaluator block validates", async () => {
  const ok = await specFile({ ...base, evaluator: { model: "claude-opus-4-8", criteria: [{ id: "a", statement: "did a thing" }] } });
  const loaded = await loadEvalSpec(ok);
  assert.equal(loaded.spec.evaluator.model, "claude-opus-4-8");

  const noModel = await specFile({ ...base, evaluator: { model: "", criteria: [{ id: "a", statement: "x" }] } });
  await assert.rejects(loadEvalSpec(noModel), /evaluator.*model/i);

  const empty = await specFile({ ...base, evaluator: { model: "m", criteria: [] } });
  await assert.rejects(loadEvalSpec(empty), /criteria/i);

  const dup = await specFile({ ...base, evaluator: { model: "m", criteria: [{ id: "a", statement: "x" }, { id: "a", statement: "y" }] } });
  await assert.rejects(loadEvalSpec(dup), /duplicate|unique/i);

  const badPoints = await specFile({ ...base, evaluator: { model: "m", criteria: [{ id: "a", statement: "x", points: 0 }] } });
  await assert.rejects(loadEvalSpec(badPoints), /points/i);
});

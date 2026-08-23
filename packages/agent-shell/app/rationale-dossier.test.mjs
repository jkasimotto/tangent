import test from "node:test";
import assert from "node:assert/strict";
import { rationaleDossierContract, rationaleDossierFile } from "./rationale-dossier.mjs";

test("rationaleDossierFile strips a goal- prefix", () => {
  assert.equal(rationaleDossierFile("otto/tangent/goal-x.md"), "otto/tangent/rationale-x.md");
});

test("rationaleDossierFile keeps a file with no goal- prefix", () => {
  assert.equal(rationaleDossierFile("otto/tangent/plain.md"), "otto/tangent/rationale-plain.md");
});

test("the contract names the absolute write path and the vault-relative commit command", () => {
  const contract = rationaleDossierContract({
    goalFile: "otto/tangent/goal-x.md",
    title: "The thing",
    area: "otto/tangent",
    treesRoot: "/Users/julian/.tangent/trees",
    session: "demo--s2",
  });
  assert.match(contract, /Write \/Users\/julian\/\.tangent\/trees\/otto\/tangent\/rationale-x\.md/);
  assert.match(contract, /tangent vault commit otto\/tangent\/rationale-x\.md -m "add: otto\/tangent rationale: <short title>"/);
});

test("the contract opens with the changed-code condition", () => {
  const contract = rationaleDossierContract({ goalFile: "otto/tangent/goal-x.md", title: "T", area: "otto/tangent", treesRoot: "/trees", session: "" });
  assert.match(contract, /^If this step changed code/);
});

test("the contract names all five content fields", () => {
  const contract = rationaleDossierContract({ goalFile: "otto/tangent/goal-x.md", title: "T", area: "otto/tangent", treesRoot: "/trees", session: "" });
  assert.match(contract, /Entry points touched/);
  assert.match(contract, /load-bearing pieces/);
  assert.match(contract, /Alternatives you rejected/);
  assert.match(contract, /Invariants that must hold/);
  assert.match(contract, /Blast radius/);
});

test("the contract links the goal", () => {
  const contract = rationaleDossierContract({ goalFile: "otto/tangent/goal-x.md", title: "T", area: "otto/tangent", treesRoot: "/trees", session: "" });
  assert.match(contract, /\[\[goal-x\]\]/);
});

test("the session line names the session when given, and stays single-spaced when empty", () => {
  const withSession = rationaleDossierContract({ goalFile: "otto/tangent/goal-x.md", title: "T", area: "otto/tangent", treesRoot: "/trees", session: "demo--s2" });
  assert.match(withSession, /Generating session: demo--s2/);
  const withoutSession = rationaleDossierContract({ goalFile: "otto/tangent/goal-x.md", title: "T", area: "otto/tangent", treesRoot: "/trees", session: "" });
  assert.match(withoutSession, /Generating session:/);
  assert.doesNotMatch(withoutSession, /Generating session:  /);
});

test("the contract hands over anyway on failure", () => {
  const contract = rationaleDossierContract({ goalFile: "otto/tangent/goal-x.md", title: "T", area: "otto/tangent", treesRoot: "/trees", session: "" });
  assert.match(contract, /hand over anyway and name the failure in your handover/);
});

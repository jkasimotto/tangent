import assert from "node:assert/strict";
import test from "node:test";

import { runAreaCli } from "../dist/cli/index.js";

/** Runs `tangent area show` against a fetch stub and returns the printed text. */
async function runShow(detail, options = []) {
  const printed = [];
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/tree") return Response.json({ areas: [{ path: "otto", name: "otto", children: [{ path: "otto/dnd", name: "dnd", children: [] }] }] });
    if (url.pathname === "/api/areas/show") return Response.json(detail);
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  try {
    await runAreaCli(["show", "otto/dnd", ...options]);
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
  return printed.join("\n");
}

test("tangent area show prints route skills and project skills as name, description, and path", async () => {
  const detail = {
    area: "otto/dnd", purpose: "", goals: [], processes: [],
    skills: [
      { name: "review", description: "Review a change.", path: "/vault/otto/skill-review.md" },
      { name: "release", description: "Ship a release.", path: "/vault/otto/dnd/skill-release.md" },
    ],
    projectSkills: [{ name: "deploy", description: "Deploy the app.", path: "/repo/.claude/skills/deploy/SKILL.md" }],
  };
  const text = await runShow(detail);
  assert.match(text, /^Skills:\n  - review: Review a change\. \(\/vault\/otto\/skill-review\.md\)\n  - release: Ship a release\. \(\/vault\/otto\/dnd\/skill-release\.md\)\n  - deploy: Deploy the app\. \(\/repo\/\.claude\/skills\/deploy\/SKILL\.md\)$/m);
});

test("tangent area show prints no Skills section when there are none", async () => {
  const text = await runShow({ area: "otto/dnd", purpose: "", goals: [], processes: [], skills: [], projectSkills: [] });
  assert.doesNotMatch(text, /Skills:/);
});

test("tangent area show omits Goals even when the server projection includes them", async () => {
  const text = await runShow({
    area: "otto/dnd", purpose: "Play.", processes: [], skills: [], projectSkills: [],
    goals: [{ slug: "hidden-work", status: "active", title: "Do not print this" }],
  });
  assert.doesNotMatch(text, /Goals \(|hidden-work|Do not print this/);
  assert.match(text, /Purpose:\nPlay\./);
});

test("tangent area show --json also omits the Goal collection", async () => {
  const text = await runShow({ area: "otto/dnd", purpose: "Play.", goals: [{ slug: "hidden-work" }] }, ["--json"]);
  assert.deepEqual(JSON.parse(text), { area: "otto/dnd", purpose: "Play." });
});

test("tangent area show prints Map resources separately from legacy launch bindings", async () => {
  const text = await runShow({
    area: "otto/dnd",
    purpose: "Play.",
    resources: "- Worktree: /tmp/launch",
    resolved: { worktree: { value: "/tmp/launch", area: "otto" } },
    workFolder: { cwd: "/tmp/launch", source: "area:otto" },
    goals: [], processes: [], skills: [], projectSkills: [],
    mapResources: {
      state: "current",
      rows: [
        {
          locator: { owner: "otto/dnd", id: "11111111-1111-4111-8111-111111111111" },
          label: "Feature checkout",
          target: { kind: "worktree", path: "/tmp/feature" },
          source: { kind: "direct" },
        },
        {
          locator: { owner: "otto", id: "22222222-2222-4222-8222-222222222222" },
          label: "Repository",
          target: { kind: "repository", path: "/tmp/repository" },
          source: { kind: "inherited", sourceArea: "otto" },
        },
      ],
    },
  });
  assert.match(text, /Resources:\n  Worktree: \/tmp\/launch \(from otto\)/);
  assert.match(text, /Map resources:\n  11111111-111  worktree  Feature checkout  \(direct; otto\/dnd\)/);
  assert.match(text, /22222222-222  repository  Repository  \(inherited from otto; otto\)/);
});

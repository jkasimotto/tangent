import assert from "node:assert/strict";
import test from "node:test";

import { runAreaCli } from "../dist/cli/index.js";

/** Runs `tangent area show` against a fetch stub and returns the printed text. */
async function runShow(detail) {
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
    await runAreaCli(["show", "otto/dnd"]);
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
  return printed.join("\n");
}

test("tangent area show prints route skills and project skills as name, description, and path", async () => {
  const detail = {
    area: "otto/dnd", purpose: "", goals: [], ideas: [], processes: [],
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
  const text = await runShow({ area: "otto/dnd", purpose: "", goals: [], ideas: [], processes: [], skills: [], projectSkills: [] });
  assert.doesNotMatch(text, /Skills:/);
});

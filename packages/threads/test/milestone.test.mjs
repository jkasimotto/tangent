process.env.TZ = "Australia/Sydney";

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTimeline, loadNodeMilestone, parseMilestoneFile, renderMilestoneSlackHtml, renderMilestoneSlackText, renderMilestoneTerminal } from "../dist/core/milestone.js";
import { setClipboardRich } from "../dist/core/clipboard.js";

const fileContent = `---
title: PG&E staging
due: 2026-07-24
start: 2026-07-17
---
# Milestone: PG&E staging

Prose that the renderer ignores.

## Critical path

### Guys (owner: @William Cheung, validator: @Hrit)

- [ ] Sidewalk guys deployed to staging
- [x] Crossarm guys reviewed
- [ ] Ground snap points for guys (owner: @Tom Wilson)

Free prose inside a group is vault-only context.

### Autodesign (owner: @Chris, validator: TBD)

- [ ] Simple pole type selection 📅 2026-07-21
- [ ] Simple ground clearance 📅 2026-07-23

## Nice to have

### Snap points and viz (owner: @Julian)

- [ ] Snap points and viz inputs landed
`;

/** A Friday during the milestone week (2026-07-17 is a Friday; due 2026-07-24 is the next Friday). */
const friday = new Date(2026, 6, 17, 9, 0, 0);
/** The following Wednesday, mid-countdown, with Mon/Tue passed. */
const wednesday = new Date(2026, 6, 22, 9, 0, 0);

test("parseMilestoneFile reads tracks, groups, owners, validators, per-line owners, ideal dates, and done state", () => {
  const milestone = parseMilestoneFile("neara/pgande/milestone-staging.md", fileContent);
  assert.equal(milestone.title, "PG&E staging");
  assert.equal(milestone.due, "2026-07-24");
  assert.deepEqual(milestone.tracks.map((track) => track.name), ["Critical path", "Nice to have"]);

  const guys = milestone.tracks[0].groups[0];
  assert.equal(guys.name, "Guys");
  assert.equal(guys.owner, "@William Cheung");
  assert.equal(guys.validator, "@Hrit");
  assert.deepEqual(guys.outcomes.map((o) => [o.text, o.done, o.owner ?? null]), [
    ["Sidewalk guys deployed to staging", false, null],
    ["Crossarm guys reviewed", true, null],
    ["Ground snap points for guys", false, "@Tom Wilson"]
  ]);

  const autodesign = milestone.tracks[0].groups[1];
  assert.equal(autodesign.validator, "TBD");
  assert.deepEqual(autodesign.outcomes.map((o) => o.ideal), ["2026-07-21", "2026-07-23"]);
});

test("a multi-owner group heading splits owner list and validator at the validator boundary", () => {
  const milestone = parseMilestoneFile("m.md", "---\ntitle: t\ndue: 2026-07-24\n---\n## T\n### Clearances (owner: @Mara, @Niranjana, validator: @Hrit)\n- [ ] a\n");
  const group = milestone.tracks[0].groups[0];
  assert.equal(group.name, "Clearances");
  assert.equal(group.owner, "@Mara, @Niranjana");
  assert.equal(group.validator, "@Hrit");
});

test("without a start date nothing is crossed off: the countdown begins today", () => {
  const noStart = fileContent.replace("start: 2026-07-17\n", "");
  const milestone = parseMilestoneFile("m.md", noStart);
  const { days, daysLeft } = buildTimeline(milestone, wednesday);
  assert.equal(days.filter((day) => day.passed).length, 0);
  assert.equal(daysLeft, 3);
});

test("parseMilestoneFile rejects a milestone without a due date", () => {
  assert.throws(() => parseMilestoneFile("x.md", "---\ntitle: t\n---\n## T\n### G\n- [ ] a\n"), /needs title and due/);
});

test("buildTimeline counts remaining working days including today and marks mini deadlines in date order", () => {
  const milestone = parseMilestoneFile("m.md", fileContent);
  const { days, daysLeft, markersByDate } = buildTimeline(milestone, friday);
  assert.equal(daysLeft, 6);
  assert.equal(days.filter((day) => day.passed).length, 0);
  assert.equal(days.length, 6);
  assert.equal(days.at(-1).isDue, true);
  assert.equal(markersByDate.get("2026-07-21"), "¹");
  assert.equal(markersByDate.get("2026-07-23"), "²");
  assert.equal(days.find((day) => day.date === "2026-07-21").marker, "¹");
});

test("mid-countdown, passed days render crossed off as dots", () => {
  const milestone = parseMilestoneFile("m.md", fileContent);
  const { days, daysLeft } = buildTimeline(milestone, wednesday);
  assert.equal(daysLeft, 3);
  const text = renderMilestoneSlackText(milestone, wednesday);
  assert.match(text, /···/);
  assert.match(text, /3 working days left/);
  assert.equal(days.at(-1).isDue, true);
});

test("renderMilestoneSlackText renders the approved shape: header, code-block timeline, tracks, groups, footer", () => {
  const milestone = parseMilestoneFile("m.md", fileContent);
  const text = renderMilestoneSlackText(milestone, friday);
  const lines = text.split("\n");
  assert.equal(lines[0], "⏳ *PG&E staging — Fri 24 Jul · 6 working days left*");
  assert.equal(lines[1], "```");
  assert.match(text, /🏁/);
  assert.match(text, /\*CRITICAL PATH\*/);
  assert.match(text, /\*Guys\* — @William Cheung · validator: @Hrit/);
  assert.match(text, /• ⬜ Sidewalk guys deployed to staging/);
  assert.match(text, /• ✅ Crossarm guys reviewed/);
  assert.match(text, /• ⬜ Ground snap points for guys — @Tom Wilson/);
  assert.match(text, /• ⬜ ¹ Simple pole type selection · ideal Tue 21/);
  assert.match(text, /\*NICE TO HAVE\*/);
  assert.match(text, /• ⬜ Snap points and viz inputs landed — @Julian/);
  assert.match(text, /Status per open bullet please: ✅ done · 🟡 on track · 🔴 blocked/);
  assert.doesNotMatch(text, /\n\n\n/);
});

test("the Nice to have track flattens groups to owner-suffixed bullets without group headings", () => {
  const milestone = parseMilestoneFile("m.md", fileContent);
  const text = renderMilestoneSlackText(milestone, friday);
  assert.doesNotMatch(text, /\*Snap points and viz\*/);
});

test("renderMilestoneSlackHtml bolds mrkdwn spans, escapes HTML, and wraps the timeline in pre", () => {
  const milestone = parseMilestoneFile("m.md", fileContent);
  const html = renderMilestoneSlackHtml(milestone, friday);
  assert.match(html, /<b>PG&amp;E staging — Fri 24 Jul · 6 working days left<\/b>/);
  assert.match(html, /<pre>/);
  assert.match(html, /<b>CRITICAL PATH<\/b><br>/);
  assert.doesNotMatch(html, /```/);
});

test("renderMilestoneTerminal renders the project view without mrkdwn asterisks or the footer", () => {
  const milestone = parseMilestoneFile("m.md", fileContent);
  const text = renderMilestoneTerminal(milestone, friday);
  assert.match(text, /PG&E staging · due Fri 24 Jul · 6 working days left/);
  assert.match(text, /CRITICAL PATH/);
  assert.doesNotMatch(text, /\*CRITICAL PATH\*/);
  assert.doesNotMatch(text, /Status per open bullet/);
});

test("loadNodeMilestone picks the nearest future due date and falls back to the most recent past", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "milestone-load-"));
  await mkdir(path.join(root, "proj"), { recursive: true });
  /** Writes one minimal milestone file in the temp node. */
  const make = (slug, due) => writeFile(
    path.join(root, "proj", `milestone-${slug}.md`),
    `---\ntitle: ${slug}\ndue: ${due}\n---\n## T\n### G (owner: x)\n- [ ] a\n`
  );
  await make("past", "2026-07-10");
  await make("near", "2026-07-24");
  await make("far", "2026-09-01");

  const near = await loadNodeMilestone(root, "proj", friday);
  assert.equal(near.title, "near");

  const afterAll = await loadNodeMilestone(root, "proj", new Date(2026, 9, 1));
  assert.equal(afterAll.title, "far");

  assert.equal(await loadNodeMilestone(root, "empty-node", friday), undefined);
});

test("setClipboardRich builds an osascript with both flavors and escaped plain text", async () => {
  const calls = [];
  /** Records the osascript invocation. */
  const run = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    return { code: 0, stdout: "", stderr: "" };
  };
  await setClipboardRich("<div><b>x</b></div>", 'line "one"\nline two', run);
  assert.equal(calls[0].command, "osascript");
  assert.match(calls[0].stdin, /«class HTML»:«data HTML[0-9a-f]+»/);
  assert.match(calls[0].stdin, /set plainText to "line \\"one\\"\\nline two"/);
});

test("setClipboardRich surfaces osascript failure", async () => {
  /** Always fails. */
  const run = async () => ({ code: 1, stdout: "", stderr: "no clipboard for you" });
  await assert.rejects(setClipboardRich("<div></div>", "x", run), /no clipboard for you/);
});

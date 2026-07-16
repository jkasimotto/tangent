import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Milestone files are the team-facing deadline view of a node: `milestone-<slug>.md` with
 * frontmatter `title` and `due`, tracks as `## <Track>` headings (Critical path, Nice to have,
 * ...), groups as `### <Name> (owner: X, validator: Y)` headings, and outcomes as checkbox lines
 * that may carry their own `(owner: X)` and an ideal mini deadline `📅 YYYY-MM-DD`. The user
 * curates the file (owners written as literal Slack handles, e.g. `@William Cheung`); this module
 * only parses and renders it. Rendering is deterministic so the same file always produces the same
 * update: models never compose this output.
 */

export type MilestoneOutcome = {
  text: string;
  done: boolean;
  /** Line-level owner override, when it differs from the group's. */
  owner?: string;
  /** Ideal mini deadline (YYYY-MM-DD); the milestone due date stays the only hard deadline. */
  ideal?: string;
};

export type MilestoneGroup = {
  name: string;
  owner?: string;
  validator?: string;
  outcomes: MilestoneOutcome[];
};

export type MilestoneTrack = {
  name: string;
  groups: MilestoneGroup[];
};

export type Milestone = {
  title: string;
  /** YYYY-MM-DD hard deadline. */
  due: string;
  /** YYYY-MM-DD the countdown started (usually the first post). Days between start and today render crossed off; absent means the countdown starts today and nothing is crossed off yet. */
  start?: string;
  tracks: MilestoneTrack[];
  /** Vault-relative path of the parsed file. */
  path: string;
};

const checkboxLine = /^- \[([ xX])\] (.+)$/;
const ownerSuffix = /\s*\(owner:\s*([^)]+)\)\s*/;
const idealDate = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*/;
// Owner is lazy so a multi-owner list with commas ("owner: @Mara, @Niranjana, validator: @Hrit")
// still splits at the ", validator:" boundary rather than the first comma.
const groupHeading = /^### (.+?)(?:\s*\(owner:\s*(.+?)(?:,\s*validator:\s*(.+?))?\))?\s*$/;

/** Parses one milestone file's content. Throws with the file path when frontmatter lacks title or due, since a milestone without a deadline cannot render a countdown. */
export function parseMilestoneFile(filePath: string, content: string): Milestone {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = frontmatter.title;
  const due = frontmatter.due;
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due || "")) {
    throw new Error(`${filePath}: milestone frontmatter needs title and due (YYYY-MM-DD).`);
  }
  const start = /^\d{4}-\d{2}-\d{2}$/.test(frontmatter.start || "") ? frontmatter.start : undefined;

  const tracks: MilestoneTrack[] = [];
  let currentTrack: MilestoneTrack | undefined;
  let currentGroup: MilestoneGroup | undefined;
  for (const line of body.split("\n")) {
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      currentTrack = { name: h2[1]!.trim(), groups: [] };
      currentGroup = undefined;
      tracks.push(currentTrack);
      continue;
    }
    const h3 = line.match(groupHeading);
    if (h3 && currentTrack) {
      currentGroup = { name: h3[1]!.trim(), owner: h3[2]?.trim(), validator: h3[3]?.trim(), outcomes: [] };
      currentTrack.groups.push(currentGroup);
      continue;
    }
    const box = line.match(checkboxLine);
    if (box && currentGroup) {
      let text = box[2]!.trim();
      const owner = text.match(ownerSuffix)?.[1]?.trim();
      text = text.replace(ownerSuffix, " ").trim();
      const ideal = text.match(idealDate)?.[1];
      text = text.replace(idealDate, " ").trim();
      currentGroup.outcomes.push({ text, done: box[1] !== " ", owner, ideal });
    }
  }
  return { title, due, start, tracks: tracks.filter((track) => track.groups.length > 0), path: filePath };
}

/** Finds the node's milestone file with the nearest due date at or after today (falling back to the most recent past one), and parses it. Returns undefined when the node has no milestone files. */
export async function loadNodeMilestone(vaultRoot: string, node: string, now: Date): Promise<Milestone | undefined> {
  const dir = path.join(vaultRoot, node);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => /^milestone-.+\.md$/.test(name));
  } catch {
    return undefined;
  }
  const milestones: Milestone[] = [];
  for (const name of names.sort()) {
    const relative = path.join(node, name);
    milestones.push(parseMilestoneFile(relative, await readFile(path.join(dir, name), "utf8")));
  }
  if (!milestones.length) return undefined;
  const today = isoDate(now);
  const upcoming = milestones.filter((m) => m.due >= today).sort((a, b) => a.due.localeCompare(b.due));
  if (upcoming.length) return upcoming[0];
  return milestones.sort((a, b) => b.due.localeCompare(a.due))[0];
}

/** The local-time YYYY-MM-DD of a Date. */
function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** One working day on the countdown timeline. */
export type TimelineDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** Three-letter label (Mon, Tue, ...). */
  label: string;
  /** Already in the past (renders crossed off). */
  passed: boolean;
  /** The due day itself (renders the 🏁). */
  isDue: boolean;
  /** Superscript marker when one or more mini deadlines land on this day. */
  marker?: string;
};

const superscripts = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/**
 * Builds the working-day (Mon to Fri) timeline for a milestone: every working day from the
 * countdown's start date (frontmatter `start`, usually stamped at the first post; today when
 * absent) through the due date. Days between start and today render crossed off, so reposting the
 * update visibly consumes the row; days-left counts the remaining working days including today.
 * Distinct mini deadlines get superscript markers in date order; the same marker is reused for
 * outcomes sharing a date.
 */
export function buildTimeline(milestone: Milestone, now: Date): { days: TimelineDay[]; daysLeft: number; markersByDate: Map<string, string> } {
  const today = isoDate(now);
  const start = startDate(milestone, now);
  const dueDate = milestone.due;

  const idealDates = [...new Set(
    milestone.tracks.flatMap((track) => track.groups.flatMap((group) => group.outcomes.flatMap((outcome) => (outcome.ideal && !outcome.done ? [outcome.ideal] : []))))
  )].sort();
  const markersByDate = new Map<string, string>();
  idealDates.forEach((date, index) => markersByDate.set(date, superscripts[Math.min(index, superscripts.length - 1)]!));

  const days: TimelineDay[] = [];
  const cursor = new Date(start);
  while (isoDate(cursor) <= dueDate) {
    const day = cursor.getDay();
    if (day >= 1 && day <= 5) {
      const date = isoDate(cursor);
      days.push({
        date,
        label: cursor.toLocaleDateString("en-US", { weekday: "short" }),
        passed: date < today,
        isDue: date === dueDate,
        marker: markersByDate.get(date)
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  const daysLeft = days.filter((day) => !day.passed).length;
  return { days, daysLeft, markersByDate };
}

/** The countdown's first day as a local Date: the milestone's `start` when set and not in the future, otherwise today. */
function startDate(milestone: Milestone, now: Date): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!milestone.start || milestone.start > isoDate(now)) return today;
  const [y, m, d] = milestone.start.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Formats "Fri 24 Jul" from YYYY-MM-DD. */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${d} ${month}`;
}

/** Formats "Tue 21" (no month) for inline ideal-deadline suffixes. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return `${date.toLocaleDateString("en-US", { weekday: "short" })} ${d}`;
}

const cellWidth = 6;

/** Renders the two timeline lines (day labels, then markers/flag) as monospace rows. Passed days render as dots. */
function timelineLines(days: TimelineDay[]): [string, string] {
  const labels = days.map((day) => (day.passed ? "···" : day.label).padEnd(cellWidth)).join("").trimEnd();
  const marks = days.map((day) => {
    const mark = day.isDue ? "🏁" : day.marker || "";
    return mark.padEnd(cellWidth);
  }).join("").trimEnd();
  return [labels, marks];
}

/** The "— owner · validator: X" suffix of a group heading line. */
function groupSuffix(group: MilestoneGroup): string {
  const parts: string[] = [];
  if (group.owner) parts.push(group.owner);
  if (group.validator) parts.push(`validator: ${group.validator}`);
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}

/** One outcome as a Slack bullet: box, timeline marker, text, per-line owner, ideal date. */
function outcomeLine(outcome: MilestoneOutcome, markersByDate: Map<string, string>): string {
  const box = outcome.done ? "✅" : "⬜";
  const marker = !outcome.done && outcome.ideal ? markersByDate.get(outcome.ideal) : undefined;
  const parts = [box, ...(marker ? [marker] : []), outcome.text];
  if (outcome.owner) parts.push(`— ${outcome.owner}`);
  if (outcome.ideal && !outcome.done) parts.push(`· ideal ${shortDate(outcome.ideal)}`);
  return `• ${parts.join(" ")}`;
}

/** True for the "Nice to have" track, whose groups flatten to owner-suffixed bullets instead of full group headings. */
function isNiceToHave(track: MilestoneTrack): boolean {
  return track.name.toLowerCase() === "nice to have";
}

/**
 * Renders the paste-ready Slack text (mrkdwn: `*bold*`, a fenced code block for the timeline).
 * Track names upper-case; "Nice to have" groups flatten to single bullets carrying the group owner.
 */
export function renderMilestoneSlackText(milestone: Milestone, now: Date): string {
  const { days, daysLeft, markersByDate } = buildTimeline(milestone, now);
  const [labels, marks] = timelineLines(days);
  const lines: string[] = [
    `⏳ *${milestone.title} — ${humanDate(milestone.due)} · ${daysLeft} working day${daysLeft === 1 ? "" : "s"} left*`,
    "```",
    labels,
    ...(marks ? [marks] : []),
    "```"
  ];
  for (const track of milestone.tracks) {
    lines.push(`*${track.name.toUpperCase()}*`);
    if (isNiceToHave(track)) {
      for (const group of track.groups) {
        for (const outcome of group.outcomes) {
          const withOwner = outcome.owner || group.owner ? { ...outcome, owner: outcome.owner || group.owner } : outcome;
          lines.push(outcomeLine(withOwner, markersByDate));
        }
      }
      lines.push("");
      continue;
    }
    lines.push("");
    for (const group of track.groups) {
      lines.push(`*${group.name}*${groupSuffix(group)}`);
      for (const outcome of group.outcomes) lines.push(outcomeLine(outcome, markersByDate));
      lines.push("");
    }
  }
  lines.push("Status per open bullet please: ✅ done · 🟡 on track · 🔴 blocked");
  return `${collapseBlankRuns(lines).join("\n")}\n`;
}

/** Renders the Slack text as clipboard HTML: `*x*` spans become <b>, the timeline becomes <pre>, other line breaks become <br>. */
export function renderMilestoneSlackHtml(milestone: Milestone, now: Date): string {
  const text = renderMilestoneSlackText(milestone, now);
  const lines = text.trimEnd().split("\n");
  const out: string[] = ["<div>"];
  let inPre = false;
  for (const line of lines) {
    if (line === "```") {
      out.push(inPre ? "</pre>" : "<pre>");
      inPre = !inPre;
      continue;
    }
    if (inPre) {
      out.push(escapeHtml(line));
      continue;
    }
    out.push(`${boldSpans(escapeHtml(line))}<br>`);
  }
  out.push("</div>");
  return `${out.join("\n")}\n`;
}

/** Replaces mrkdwn *bold* spans with <b> tags (input already HTML-escaped). */
function boldSpans(line: string): string {
  return line.replace(/\*([^*]+)\*/g, "<b>$1</b>");
}

/** Escapes the three HTML-significant characters. */
function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Collapses runs of blank lines to single blanks and trims trailing blanks, so track/group assembly never emits double gaps. */
function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  while (out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * Renders the terminal project view: the same content as the Slack text but without mrkdwn
 * asterisks or the paste footer, for `tangent threads milestone <node>` (the "give me the project
 * view" glance).
 */
export function renderMilestoneTerminal(milestone: Milestone, now: Date): string {
  const { days, daysLeft, markersByDate } = buildTimeline(milestone, now);
  const [labels, marks] = timelineLines(days);
  const lines: string[] = [
    `${milestone.title} · due ${humanDate(milestone.due)} · ${daysLeft} working day${daysLeft === 1 ? "" : "s"} left`,
    "",
    `  ${labels}`,
    ...(marks ? [`  ${marks}`] : []),
    ""
  ];
  for (const track of milestone.tracks) {
    lines.push(track.name.toUpperCase());
    for (const group of track.groups) {
      lines.push(`  ${group.name}${groupSuffix(group)}`);
      for (const outcome of group.outcomes) lines.push(`  ${outcomeLine(outcome, markersByDate)}`);
    }
    lines.push("");
  }
  return `${collapseBlankRuns(lines).join("\n")}\n`;
}

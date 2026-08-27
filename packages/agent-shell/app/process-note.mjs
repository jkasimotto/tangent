// A process is a note: `<area>/process-<slug>.md` (ADR-0043, D16). Its
// frontmatter says when it is due, either `schedule:` in calendar words or
// `when:` as a shell probe polled `every:` so often. Its body is the
// instruction the brain hands the worker. This module parses the note and
// computes schedule slots. It reads no files and keeps no state.

const DAY_WORDS = new Map([
  ["sunday", 0], ["sun", 0], ["sundays", 0],
  ["monday", 1], ["mon", 1], ["mondays", 1],
  ["tuesday", 2], ["tue", 2], ["tues", 2], ["tuesdays", 2],
  ["wednesday", 3], ["wed", 3], ["wednesdays", 3],
  ["thursday", 4], ["thu", 4], ["thurs", 4], ["thursdays", 4],
  ["friday", 5], ["fri", 5], ["fridays", 5],
  ["saturday", 6], ["sat", 6], ["saturdays", 6],
]);
const DAY_SETS = new Map([
  ["daily", [0, 1, 2, 3, 4, 5, 6]],
  ["weekdays", [1, 2, 3, 4, 5]],
  ["weekends", [0, 6]],
]);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME = /^(\d{1,2}):(\d{2})$/;
const EVERY = /^(\d+)\s*(s|m|h|d)$/;
const STATUSES = new Set(["active", "paused"]);

/** The slug of a process note file, or null when the name is not `process-<slug>.md`. */
export function processSlugFromFile(file) {
  const match = String(file ?? "").split("/").pop()?.match(/^process-([a-z0-9][a-z0-9-]*)\.md$/);
  return match ? match[1] : null;
}

/** Parses the `---` frontmatter block into a flat key to value map, plus the body after it. */
export function splitFrontmatter(text) {
  const match = String(text ?? "").match(/^---\n([\s\S]*?)\n---\n?/);
  const fields = {};
  if (!match) return { fields, body: String(text ?? "") };
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
  return { fields, body: String(text).slice(match[0].length) };
}

/** Parses a duration word such as `30m`, `2h`, or `1d` into milliseconds. */
export function parseEvery(value) {
  const match = String(value ?? "").trim().match(EVERY);
  if (!match) throw new Error(`every must be a duration such as 30m, 2h, or 1d, not ${JSON.stringify(String(value ?? ""))}`);
  const amount = Number(match[1]);
  if (amount < 1) throw new Error("every must be positive");
  return amount * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
}

/**
 * Parses calendar words into days and times: `daily 09:00`, `weekdays 08:30`,
 * `mondays 10:00`, `mon,thu 16:00`, `daily 07:30, 16:00, 19:30 UTC`. Times
 * are local unless the words end in `UTC`. Days default to daily.
 */
export function parseSchedule(words) {
  const tokens = String(words ?? "").trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error("schedule needs calendar words such as daily 09:00");
  const days = new Set();
  const times = [];
  let utc = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const time = token.match(TIME);
    if (time) {
      const hour = Number(time[1]);
      const minute = Number(time[2]);
      if (hour > 23 || minute > 59) throw new Error(`schedule time ${token} is not a time of day`);
      times.push({ hour, minute });
    } else if (DAY_SETS.has(lower)) {
      for (const day of DAY_SETS.get(lower)) days.add(day);
    } else if (DAY_WORDS.has(lower)) {
      days.add(DAY_WORDS.get(lower));
    } else if (lower === "utc" || lower === "z") {
      utc = true;
    } else if (lower !== "at" && lower !== "and" && lower !== "on" && lower !== "every") {
      throw new Error(`schedule word ${JSON.stringify(token)} is not a day, a time, or UTC`);
    }
  }
  if (!times.length) throw new Error("schedule needs at least one time such as 09:00");
  const dayList = days.size ? [...days].sort() : DAY_SETS.get("daily");
  times.sort((left, right) => left.hour - right.hour || left.minute - right.minute);
  return { days: dayList, times, utc, text: describeSchedule({ days: dayList, times, utc }) };
}

/** The calendar words back in one canonical form, for lists and prompts. */
export function describeSchedule({ days, times, utc }) {
  const key = days.join(",");
  const dayText = key === "0,1,2,3,4,5,6" ? "Daily" : key === "1,2,3,4,5" ? "Weekdays" : key === "0,6" ? "Weekends" : days.map((day) => `${DAY_NAMES[day]}s`).join(", ");
  const timeText = times.map((time) => `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`).join(", ");
  return `${dayText} ${timeText}${utc ? " UTC" : ""}`;
}

/** Builds one Date for a calendar day and time in the schedule's zone. */
function slotDate(schedule, year, month, day, time) {
  return schedule.utc ? new Date(Date.UTC(year, month, day, time.hour, time.minute)) : new Date(year, month, day, time.hour, time.minute);
}

/** The year, month, day, and weekday of an instant in the schedule's zone. */
function calendarOf(schedule, instant) {
  const date = new Date(instant);
  return schedule.utc
    ? { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() }
    : { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

/** Every slot of a schedule from `offset` days before the instant's day to `offset` days after, in time order. */
function slotsAround(schedule, instant, offset = 8) {
  const { year, month, day } = calendarOf(schedule, instant);
  const slots = [];
  for (let delta = -offset; delta <= offset; delta += 1) {
    for (const time of schedule.times) {
      const slot = slotDate(schedule, year, month, day + delta, time);
      const weekday = schedule.utc ? slot.getUTCDay() : slot.getDay();
      if (schedule.days.includes(weekday)) slots.push(slot);
    }
  }
  return slots.sort((left, right) => left.getTime() - right.getTime());
}

/** The latest slot at or before the instant, or null. Missed slots coalesce to this one. */
export function latestSlotAtOrBefore(schedule, instant) {
  const at = new Date(instant).getTime();
  const past = slotsAround(schedule, instant).filter((slot) => slot.getTime() <= at);
  return past.length ? past[past.length - 1] : null;
}

/** The first slot after the instant, or null. */
export function nextSlotAfter(schedule, instant) {
  const at = new Date(instant).getTime();
  return slotsAround(schedule, instant).find((slot) => slot.getTime() > at) ?? null;
}

/** The title of a process: its first heading, else the slug in words. */
function processTitle(body, slug) {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || slug.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Parses one process note. Returns the process, or `{ error }` beside the
 * fields it could read, so a list shows a broken note instead of hiding it.
 */
export function parseProcessNote(text, { file, area }) {
  const slug = processSlugFromFile(file);
  const { fields, body } = splitFrontmatter(text);
  const note = {
    area, file, slug: slug ?? String(file).split("/").pop(),
    title: processTitle(body, slug ?? "process"),
    status: (fields.status || "active").toLowerCase(),
    schedule: null, when: fields.when || null, every: fields.every || null, everyMs: null,
    launch: fields.launch || null, path: fields.path || null, verify: /^(yes|true)$/i.test(fields.verify ?? ""),
    body: body.trim(),
    error: null,
  };
  try {
    if (!slug) throw new Error("the file name must be process-<slug>.md");
    if (fields.type !== "process") throw new Error("the frontmatter needs type: process");
    if (!STATUSES.has(note.status)) throw new Error(`status must be active or paused, not ${JSON.stringify(fields.status)}`);
    if (fields.schedule && fields.when) throw new Error("use schedule: or when:, not both");
    if (!fields.schedule && !fields.when) throw new Error("the frontmatter needs schedule: <calendar words> or when: <shell probe> with every: <duration>");
    if (fields.schedule) note.schedule = parseSchedule(fields.schedule);
    if (note.launch && /\s/.test(note.launch)) throw new Error("launch must be harness[/model[/effort]], such as launch: claude/opus-5, not a command line");
    if (fields.when) {
      if (!fields.every) throw new Error("when: needs every: <duration>, such as every: 30m");
      note.everyMs = parseEvery(fields.every);
    }
    if (!note.body) throw new Error("the body is empty; write the instruction the brain gives the worker");
  } catch (error) {
    note.error = error.message;
  }
  return note;
}

/** One line that says when a process runs, for lists and the brain. */
export function describeWhen(note) {
  if (note.schedule) return note.schedule.text;
  if (note.when) return `Every ${note.every} while \`${note.when}\` exits 0`;
  return "No schedule";
}

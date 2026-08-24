import path from "node:path";

/** Normalizes a person name for comparison and stable roster-local keys. */
export function normalizePersonName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Validates and canonicalizes names that can be stored in a flat list. */
export function validatePeople(values) {
  if (!Array.isArray(values)) throw new Error("people must be a list");
  const people = values.map((value) => String(value).trim()).filter(Boolean);
  const normalized = new Set();
  for (const name of people) {
    if (/[\[\],\r\n]/.test(name)) {
      throw new Error(`The person name "${name}" cannot contain commas, brackets, or line breaks.`);
    }
    const key = normalizePersonName(name);
    if (normalized.has(key)) throw new Error(`The People section contains the duplicate name "${name}".`);
    normalized.add(key);
  }
  return people;
}

/** Reads the strict bullet list from an Area note's People section. */
export function peopleFromAreaNote(text) {
  const match = String(text ?? "").match(/^## People[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!match) return [];
  const people = [];
  const normalized = new Set();
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!bullet) throw new Error("The People section must contain only bullet names.");
    const name = bullet[1].trim();
    const key = normalizePersonName(name);
    if (!key) throw new Error("A person name cannot be empty.");
    if (normalized.has(key)) throw new Error(`The People section contains the duplicate name "${name}".`);
    normalized.add(key);
    people.push(name);
  }
  return validatePeople(people);
}

/** Reads a flat frontmatter array such as `[Dan, Brida]`. */
export function assigneesFromFrontmatter(value) {
  const source = String(value ?? "").trim();
  if (!source) return [];
  if (!source.startsWith("[") || !source.endsWith("]")) throw new Error("assignees must be a bracketed list");
  const body = source.slice(1, -1).trim();
  if (!body) return [];
  return body.split(",").map((name) => name.trim()).filter(Boolean);
}

/** Gives one person a stable key inside the Area that defines the roster. */
export function personKey(rosterArea, name) {
  return `${rosterArea}::${normalizePersonName(name)}`;
}

/** Validates a set of requested names and returns it in roster order. */
export function validateAssignees(requested, roster) {
  const validRoster = validatePeople(roster);
  const values = Array.isArray(requested) ? requested.map((name) => String(name).trim()).filter(Boolean) : [];
  const rosterByName = new Map(validRoster.map((name) => [normalizePersonName(name), name]));
  const seen = new Set();
  for (const name of values) {
    const normalized = normalizePersonName(name);
    if (seen.has(normalized)) throw new Error(`The assignee "${name}" occurs more than once.`);
    seen.add(normalized);
    if (!rosterByName.has(normalized)) {
      const valid = validRoster.length ? validRoster.join(", ") : "none (this Area has no people roster)";
      throw new Error(`Unknown assignee "${name}". Valid people: ${valid}.`);
    }
  }
  return validRoster.filter((name) => seen.has(normalizePersonName(name)));
}

/** Projects labels and roster-scoped keys for one Goal. */
export function projectAssignees(names, rosterArea) {
  return {
    assignees: [...names],
    assigneeKeys: names.map((name) => personKey(rosterArea, name)),
    unassigned: names.length === 0,
  };
}

/** Replaces or adds one flat Goal frontmatter list. */
export function withAssigneesFrontmatter(text, names) {
  const match = String(text).match(/^---\n[\s\S]*?\n---/);
  if (!match) throw new Error("note has no frontmatter");
  const value = `assignees: [${names.join(", ")}]`;
  const field = /^assignees:.*$/m;
  const frontmatter = field.test(match[0])
    ? match[0].replace(field, value)
    : match[0].replace(/\n---$/, `\n${value}\n---`);
  return String(text).replace(match[0], frontmatter);
}

/** Replaces the complete People section and preserves the next section. */
export function withPeopleSection(text, people) {
  const body = people.map((name) => `- ${name}`).join("\n");
  const section = `## People\n\n${body}`;
  const pattern = /^## People[ \t]*\n[\s\S]*?(?=^## |(?![\s\S]))/m;
  if (pattern.test(text)) return String(text).replace(pattern, `${section}\n\n`);
  const firstSection = String(text).search(/^## /m);
  if (firstSection < 0) return `${String(text).trimEnd()}\n\n${section}\n`;
  return `${String(text).slice(0, firstSection)}${section}\n\n${String(text).slice(firstSection)}`;
}

/** Finds the nearest Area path that defines a People section. */
export function nearestRosterArea(area, notesByArea) {
  const parts = String(area).split("/").filter(Boolean);
  for (let count = parts.length; count > 0; count -= 1) {
    const candidate = parts.slice(0, count).join("/");
    const note = notesByArea.get(candidate) ?? "";
    if (/^## People\s*$/m.test(note)) return candidate;
  }
  return null;
}

/** True when a descendant still inherits the roster from one defining Area. */
export function inheritsRoster(area, rosterArea, notesByArea) {
  return nearestRosterArea(area, notesByArea) === rosterArea;
}

/** Returns a readable Area note path for diagnostics. */
export function areaNotePath(area) {
  return path.posix.join(area, `${area.split("/").pop()}.md`);
}

const ORDER = ["Goals", "Documents", "Notes", "Agents", "Sub-Areas", "Commits", "Links"];
/** Reports whether an indexed record belongs to an Area subtree. */
const under = (item, area) => item.area === area || String(item.area ?? "").startsWith(`${area}/`);
/** Normalizes one indexed fact into a picker choice. */
const choice = (item, section, kind = item.kind) => ({ kind, ref: item.ref ?? item.file, title: item.title ?? item.name ?? item.subject ?? item.url, status: item.status ?? "", area: item.area, changedAt: item.changedAt ?? item.at ?? 0, section });

/** Builds the contextual picker sections for one exact Area. */
export function pickerSections(target, index = [], targetFacts = {}, sceneFacts = {}) {
  const own = index.filter((item) => item.area === target);
  const placed = new Set(sceneFacts.placedChildren ?? targetFacts.placedChildren ?? []);
  const goals = own.filter((item) => item.kind === "goal" || item.goal).sort((a, b) => goalRank(a) - goalRank(b) || String(a.title).localeCompare(String(b.title))).map((item) => choice(item, "Goals", "goal"));
  const documents = own.filter((item) => item.kind === "document").sort((a, b) => Number(b.changedAt ?? 0) - Number(a.changedAt ?? 0)).slice(0, 8).map((item) => choice(item, "Documents", "document"));
  const notes = own.filter((item) => item.kind === "note" && (item.file?.endsWith(`/${target.split("/").at(-1)}.md`) || /\/process-[^/]+\.md$/.test(item.file))).map((item) => choice(item, "Notes", "document"));
  const agents = own.filter((item) => ["brain", "agent"].includes(item.kind)).map((item) => choice(item, "Agents"));
  const areas = index.filter((item) => item.kind === "area" && String(item.area).startsWith(`${target}/`) && !String(item.area).slice(target.length + 1).includes("/") && !placed.has(item.area)).map((item) => choice(item, "Sub-Areas", "area"));
  const commits = (targetFacts.commits ?? []).map((item) => ({ ...choice(item, "Commits", "commit"), ref: `vault@${item.sha}`, status: new Date(item.at).toLocaleDateString() }));
  const links = (targetFacts.links ?? []).map((item) => ({ ...choice(item, "Links", "link"), ref: item.url }));
  const values = { Goals: goals, Documents: documents, Notes: notes, Agents: agents, "Sub-Areas": areas, Commits: commits, Links: links };
  return ORDER.flatMap((title) => values[title]?.length ? [{ title, choices: values[title] }] : []);
}

/** Ranks active Goals before checks and finished Goals. */
function goalRank(goal) {
  if (["done", "dropped", "wont-do", "won't do"].includes(goal.status)) return 3;
  if (goal.status === "verify" || goal.verify) return 1;
  return 0;
}

/** Filters contextual sections without changing their order. */
export function filterChoices(sections, query = "") {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections.map((section) => ({ ...section, choices: section.choices.filter((item) => `${item.kind} ${item.title} ${item.ref}`.toLowerCase().includes(needle)) })).filter((section) => section.choices.length);
}

/** Searches the whole vault, with an optional path-prefix query. */
export function wideChoices(query = "", index = []) {
  const raw = query.trim(); const slash = raw.includes("/") ? raw.slice(0, raw.lastIndexOf("/") + 1) : ""; const needle = (slash ? raw.slice(slash.length) : raw).toLowerCase();
  return index.filter((item) => (!slash || under(item, slash.replace(/\/$/, ""))) && (!needle || `${item.title ?? item.name ?? ""} ${item.file ?? item.ref ?? ""}`.toLowerCase().includes(needle)))
    .map((item) => choice(item, "Vault")).sort((a, b) => Number(!String(a.title).toLowerCase().startsWith(needle)) - Number(!String(b.title).toLowerCase().startsWith(needle)) || Number(b.changedAt) - Number(a.changedAt) || String(a.ref).length - String(b.ref).length);
}

export default { filterChoices, pickerSections, wideChoices };

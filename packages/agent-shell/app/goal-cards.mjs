import { createHash } from "node:crypto";

export const CARD_KINDS = Object.freeze(["copy", "link", "links", "progress", "checklist", "commits", "reviews"]);

/** Throws a card validation error naming the card kind. */
const fail = (kind, message) => { throw new Error(`${kind} card: ${message}`); };
/** Returns a trimmed string field, failing when it is empty or longer than max. */
const text = (kind, value, name, max = 80) => {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) fail(kind, `${name} must be 1-${max} characters`);
  return result;
};

/** Resolves a card URL: http(s) as given, otherwise a vault file through resolveFile. */
async function url(kind, value, resolveFile) {
  const raw = String(value ?? "").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return { href: parsed.href, host: parsed.host };
  } catch {}
  if (resolveFile) {
    try { return await resolveFile(raw); } catch {}
  }
  fail(kind, "url must be http, https, or a vault or repository file");
}

/** Validates untrusted card data into the closed product-owned card vocabulary. */
export async function validateCard(kindValue, titleValue, raw = {}, resolveFile) {
  const kind = String(kindValue ?? "").trim();
  if (!CARD_KINDS.includes(kind)) throw new Error(`card kind "${kind}" is not available`);
  const title = text(kind, titleValue, "title");
  let fields;
  if (kind === "copy") {
    const value = text(kind, raw.text, "text", 10000);
    if (/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/u.test(value)) fail(kind, "text contains control characters");
    fields = { text: value };
  } else if (kind === "link") {
    fields = { url: await url(kind, raw.url, resolveFile), label: text(kind, raw.label ?? title, "label") };
  } else if (kind === "links") {
    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 3) fail(kind, "items must contain 1-3 entries");
    fields = { items: await Promise.all(raw.items.map(async (item) => ({ label: text(kind, item.label, "label"), url: await url(kind, item.url, resolveFile) }))) };
  } else if (kind === "progress") {
    if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 20) fail(kind, "steps must contain 1-20 entries");
    const steps = raw.steps.map((step) => {
      const status = String(step.status ?? "").trim();
      if (!["done", "current", "todo"].includes(status)) fail(kind, "step status must be done, current, or todo");
      return { label: text(kind, step.label, "step label"), status };
    });
    const current = raw.current == null || raw.current === "" ? null : Number(raw.current);
    if (current !== null && (!Number.isInteger(current) || current < 1 || current > steps.length)) fail(kind, "current must name a 1-based step");
    fields = { steps, current };
  } else if (kind === "checklist") {
    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 20) fail(kind, "items must contain 1-20 entries");
    fields = { items: raw.items.map((item) => ({ label: text(kind, item.label, "item label"), done: item.done === true })) };
  } else if (kind === "commits") {
    if (!Array.isArray(raw.commits) || raw.commits.length < 1 || raw.commits.length > 5) fail(kind, "commits must contain 1-5 entries");
    fields = { repo: text(kind, raw.repo, "repo", 1000), commits: await Promise.all(raw.commits.map(async (commit) => {
      const hash = text(kind, commit.hash, "hash", 40);
      if (!/^[0-9a-f]{7,40}$/i.test(hash)) fail(kind, "hash must be 7-40 hexadecimal characters");
      return { hash, subject: text(kind, commit.subject, "subject", 500), ...(commit.url ? { url: await url(kind, commit.url, resolveFile) } : {}) };
    })) };
  } else {
    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 10) fail(kind, "items must contain 1-10 entries");
    fields = { items: await Promise.all(raw.items.map(async (item) => ({ id: text(kind, item.id, "id"), title: text(kind, item.title, "review title", 500), url: await url(kind, item.url, resolveFile), state: text(kind, item.state, "state", 40) }))) };
  }
  return Object.freeze({ kind, title, fields });
}

/** Sorts object keys recursively so equal fields hash equally. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** Hashes a card's canonical fields as sha256 hex. */
export function cardFieldsHash(fields) { return createHash("sha256").update(JSON.stringify(canonical(fields))).digest("hex"); }

/** Returns the one-line summary a card shows in a list. */
export function cardSummary(card) {
  const f = card.fields;
  if (card.kind === "copy") return f.text.replace(/\s+/g, " ").slice(0, 100);
  if (card.kind === "link") return f.url.host ?? f.label;
  if (card.kind === "progress") return `${f.steps.filter((s) => s.status === "done").length} of ${f.steps.length} done`;
  if (card.kind === "checklist") return `${f.items.filter((i) => i.done).length} of ${f.items.length} done`;
  const rows = f.items ?? f.commits ?? [];
  return `${rows.length} ${card.kind === "commits" ? "commit" : card.kind === "reviews" ? "review" : "link"}${rows.length === 1 ? "" : "s"}`;
}

import { escapeHtml } from "./text-format.js";

/**
 * The commits a rebuild will deploy, one row each. Both the update panel and
 * the rebuild confirmation used to join every commit into one string, which
 * wrapped into an unreadable run of hashes, subjects and authors. Each commit
 * now holds its own row so four of them still read at a glance. Returns the
 * inner HTML of a `ul.update-commits`.
 */
export function rebuildCommitRows(commits = []) {
  return commits.map(rebuildCommitRow).join("");
}

/** One pending commit as its own row: hash, subject, then author under it. */
function rebuildCommitRow(commit) {
  return `<li class="update-commit"><code>${escapeHtml(commit.shortHash || commit.hash || "")}</code><span class="update-commit-subject">${escapeHtml(commit.subject || "")}</span><span class="update-commit-author">${escapeHtml(commit.author || "")}</span></li>`;
}

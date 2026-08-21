// The Area map's shared facts (design contract: otto/tangent/design-area-map).
//
// Everything here is a pure function over the vault index: Document kind from
// the file name, recency, attention rank, desk panel grouping, and subtree
// helpers. The server uses it to enrich /api/vault, the browser uses it to
// render the desk and the Area map, and the tests run it without either. It
// is a plain script that registers a global, the same shape as
// document-comments.js, so both sides load one copy.
(function (root) {
  "use strict";

  /**
   * Prefixes that always count as a Document kind. Any other prefix counts
   * when at least two files in the vault share it (a convention needs
   * repetition); a one-off slug such as `world-viewer-...` is a `page`.
   */
  const KNOWN_KINDS = ["design", "impl", "plan", "reference", "status", "use-case", "goal", "outcome", "note", "recur", "page"];
  /** Multi-word prefixes that stay whole instead of splitting at the first dash. */
  const MULTIWORD_PREFIXES = ["use-case"];
  /** Chip order on the map: the known kinds first, then any other kind by name. */
  const KIND_ORDER = ["design", "impl", "plan", "reference", "status", "use-case", "goal", "note", "page"];
  const KIND_LABELS = { "use-case": "use case", impl: "impl", note: "note", page: "page" };
  const CLOSED_GOAL_STATUS = new Set(["done", "dropped", "deferred"]);
  const DAY = 86_400_000;

  /** The file stem's prefix: `design-foo` → `design`, `use-case-x` → `use-case`, `readme` → "". */
  function prefixOf(stem) {
    for (const multi of MULTIWORD_PREFIXES) if (stem.startsWith(`${multi}-`)) return multi;
    const dash = stem.indexOf("-");
    return dash > 0 ? stem.slice(0, dash) : "";
  }

  /** The stem of a vault-relative Markdown path. */
  function stemOf(file) {
    return String(file).split("/").pop().replace(/\.md$/i, "");
  }

  /**
   * Assigns `docKind` to every record. Records carry `kind` = note | goal |
   * document already (the shell's structural kind); `docKind` is the finer,
   * file-name kind the map filters by. Returns the count per docKind.
   */
  function assignKinds(records) {
    const prefixCounts = new Map();
    for (const record of records) {
      if (record.kind !== "document") continue;
      const prefix = prefixOf(stemOf(record.file));
      if (prefix) prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
    const counts = new Map();
    for (const record of records) {
      let kind;
      if (record.kind === "note") kind = "note";
      else if (record.kind === "goal") kind = "goal";
      else {
        const prefix = prefixOf(stemOf(record.file));
        kind = prefix && (KNOWN_KINDS.includes(prefix) || (prefixCounts.get(prefix) ?? 0) >= 2) ? prefix : "page";
      }
      record.docKind = kind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
  }

  /** The chip label for one kind. */
  function kindLabel(kind) {
    return KIND_LABELS[kind] ?? kind;
  }

  /** Orders kinds for chips: known order first, unknown kinds by name after. */
  function orderKinds(kinds) {
    return [...kinds].sort((left, right) => {
      const l = KIND_ORDER.indexOf(left), r = KIND_ORDER.indexOf(right);
      if (l >= 0 && r >= 0) return l - r;
      if (l >= 0) return -1;
      if (r >= 0) return 1;
      return left.localeCompare(right);
    });
  }

  /**
   * Node opacity from age: full for seven days, then a linear fade to a floor
   * of 0.45 at ninety days. Recency is a fact the map shows, not a claim.
   */
  function recencyOpacity(changedAt, now) {
    if (!changedAt) return 0.45;
    const days = (now - changedAt) / DAY;
    if (days <= 7) return 1;
    if (days >= 90) return 0.45;
    return 1 - ((days - 7) / 83) * 0.55;
  }

  /** Whole-day difference between two timestamps in local time. */
  function dayIndex(at, offsetMinutes) {
    return Math.floor((at - offsetMinutes * 60_000) / DAY);
  }

  /** `today`, `yesterday`, `5d ago`, `3w ago`, `4mo ago`: the age label of a change. */
  function relativeDay(changedAt, now, offsetMinutes = 0) {
    if (!changedAt) return "";
    const days = dayIndex(now, offsetMinutes) - dayIndex(changedAt, offsetMinutes);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return `${days}d ago`;
    if (days < 60) return `${Math.round(days / 7)}w ago`;
    return `${Math.round(days / 30)}mo ago`;
  }

  /** True while a Goal is still open (not done, dropped, or deferred). */
  function goalIsOpen(goal) {
    return !CLOSED_GOAL_STATUS.has(goal?.status);
  }

  /**
   * Attention rank of a Goal: 0 needs Julian, 1 an agent works, 2 ready.
   * `attention` is the desk's word for the Goal (`waiting`, `working`, or
   * anything else), computed from sessions by the caller.
   */
  function goalAttentionRank(attention) {
    if (attention === "waiting") return 0;
    if (attention === "working") return 1;
    return 2;
  }

  /**
   * Desk order of Goals: needs you, then agents working, then ready; inside
   * each group the latest change first, then title. `attentionOf(goal)`
   * returns the desk word for the Goal.
   */
  function orderGoals(goals, attentionOf) {
    return [...goals].sort((left, right) =>
      goalAttentionRank(attentionOf(left)) - goalAttentionRank(attentionOf(right))
      || (right.changedAt ?? right.mtime ?? 0) - (left.changedAt ?? left.mtime ?? 0)
      || String(left.title).localeCompare(String(right.title)));
  }

  /** Outline and shelf order of Documents: latest change first, then title. */
  function orderDocuments(documents) {
    return [...documents].sort((left, right) =>
      (right.changedAt ?? right.mtime ?? 0) - (left.changedAt ?? left.mtime ?? 0)
      || String(left.title).localeCompare(String(right.title)));
  }

  /** True when `path` is `area` or lies inside it. */
  function isInside(path, area) {
    return path === area || String(path).startsWith(`${area}/`);
  }

  /** The parent Area path, or "" at the top. */
  function parentOf(path) {
    return String(path).split("/").slice(0, -1).join("/");
  }

  /** The direct children of `area` among `paths`. */
  function childrenOf(area, paths) {
    return paths.filter((path) => parentOf(path) === area).sort();
  }

  /**
   * The direct sub-Area of `scope` that contains `path`, or null when `path`
   * is the scope itself. Deeper Areas share their nearest direct sub-Area,
   * so the map colors `storm-response` like `embedded-js` inside `hackathon`.
   */
  function subAreaOf(path, scope) {
    if (path === scope || !isInside(path, scope)) return null;
    const rest = String(path).slice(scope.length + 1).split("/")[0];
    return `${scope}/${rest}`;
  }

  /**
   * Desk panels (design Decision 1). An Area is a panel when it has open
   * Goals of its own and no ancestor is a panel. Every descendant with open
   * Goals becomes an indented section of the nearest panel above it. Areas
   * without open work anywhere are left out. `openCounts` maps area path to
   * the number of open Goals stored directly in it. Returns
   * [{ path, sections: [path, ...] }] in path order.
   */
  function deskPanels(openCounts) {
    const paths = [...openCounts.keys()].sort();
    const withWork = new Set(paths.filter((path) => (openCounts.get(path) ?? 0) > 0));
    const panels = [];
    for (const path of paths) {
      if (!withWork.has(path)) continue;
      const ancestorPanel = panels.find((panel) => isInside(path, panel.path) && path !== panel.path);
      if (ancestorPanel) {
        ancestorPanel.sections.push(path);
        continue;
      }
      panels.push({ path, sections: [] });
    }
    return panels;
  }

  /**
   * Desk order of panels (design-area-map, recently-worked-areas-sort-to-
   * the-top): a panel with an agent working now sorts first; among the
   * rest, most recent Goal or vault activity wins; ties keep path order.
   * `activityOf(panel)` returns `{ working, mtime }` for one panel record.
   */
  function orderPanels(panels, activityOf) {
    return [...panels].sort((left, right) => {
      const l = activityOf(left), r = activityOf(right);
      return (r.working ? 1 : 0) - (l.working ? 1 : 0) || (r.mtime ?? 0) - (l.mtime ?? 0);
    });
  }

  const api = {
    KNOWN_KINDS, KIND_ORDER, MULTIWORD_PREFIXES,
    prefixOf, stemOf, assignKinds, kindLabel, orderKinds,
    recencyOpacity, relativeDay,
    goalIsOpen, goalAttentionRank, orderGoals, orderDocuments,
    isInside, parentOf, childrenOf, subAreaOf, deskPanels, orderPanels,
  };
  root.AgentShellAreaMap = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

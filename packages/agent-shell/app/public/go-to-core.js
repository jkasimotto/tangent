// The Go to finder's shared facts (design contract: otto/tangent/design-find-a-document-by-title).
//
// Everything here is a pure function: the search normalizer, the row ranker
// that turns a typed query into the finder's list, and the return point that
// brings Julian back to the exact screen a Document or a brain opened over.
// The browser loads it beside shell.js, the tests run it without a DOM. It is
// a plain script that registers a global, the same shape as area-map-core.js.

  /**
   * The state keys that identify one screen. A return point copies exactly
   * these. Drafts stay in `state` because nothing clears them, and the reader's
   * own trail travels in the point's `document` field instead.
   */
  const RETURN_POINT_KEYS = [
    "view", "currentFile", "agentSessionName", "agentReturnView", "decisionReturnView",
    "describeSessionName", "createReturnView", "harnessReturnView",
    "programId", "areaSelection", "query", "workFilter",
  ];

  /** The Back button word for each captured view. */
  const RETURN_POINT_LABELS = {
    work: "Work",
    create: "New work",
    describe: "Describe work",
    areas: "Areas",
    "area-edit": "Area edit",
    "program-detail": "Program",
    "program-session": "Program",
    "program-create": "New program",
    harnesses: "Harnesses",
    agent: "Agent",
    decision: "Next step",
    document: "Document",
  };

  /** Normalizes conversational wording for forgiving local search. */
  function normalizedSearchText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/p\s*&\s*g\s*&\s*e/g, "pgande")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.length > 4 && word.endsWith("ing") ? word.slice(0, -3) : word.length > 3 && word.endsWith("ed") ? word.slice(0, -2) : word)
      .join(" ");
  }

  /** The normalized file-name slug for a row's file: the basename, no extension. */
  function fileSlug(file) {
    const base = String(file ?? "").split("/").pop() ?? "";
    return normalizedSearchText(base.replace(/\.md$/i, ""));
  }

  /**
   * Ranks the finder's rows against one typed query. Every typed word must be
   * a substring of the normalized name, kind word, Area path, or file-name
   * slug, so Julian can predict the result from his own words and can find a
   * Document by its file name even when the title differs. A live brain ranks
   * before other rows of the same tier, because a brain record's updatedAt is
   * its start time and a newer Document would otherwise push a working brain
   * down. Without a query the list is the live brains first, then the newest
   * change.
   */
  function matchRows(rows, query, limit) {
    const words = normalizedSearchText(query).split(" ").filter(Boolean);
    if (!words.length) {
      const idle = [...rows].sort((left, right) =>
        Number(right.live) - Number(left.live)
        || Number(right.changedAt ?? 0) - Number(left.changedAt ?? 0)
        || String(left.name).localeCompare(String(right.name)));
      return idle.slice(0, limit);
    }
    const scored = [];
    for (const row of rows) {
      const name = normalizedSearchText(`${row.kindLabel} ${row.name}`);
      const joinedName = name.replaceAll(" ", "");
      const area = normalizedSearchText(row.area);
      const joinedArea = area.replaceAll(" ", "");
      const slug = fileSlug(row.file);
      const joinedSlug = slug.replaceAll(" ", "");
      const bareName = normalizedSearchText(row.name);
      let keep = true;
      let allInName = true;
      for (const word of words) {
        const inName = name.includes(word) || joinedName.includes(word);
        if (!inName) allInName = false;
        if (!inName && !area.includes(word) && !joinedArea.includes(word) && !slug.includes(word) && !joinedSlug.includes(word)) {
          keep = false;
          break;
        }
      }
      if (!keep) continue;
      scored.push({ row, allInName, startsName: bareName.startsWith(words[0]) });
    }
    scored.sort((left, right) =>
      Number(right.allInName) - Number(left.allInName)
      || Number(right.startsName) - Number(left.startsName)
      || Number(right.row.live) - Number(left.row.live)
      || Number(right.row.changedAt ?? 0) - Number(left.row.changedAt ?? 0)
      || String(left.row.name).localeCompare(String(right.row.name)));
    return scored.slice(0, limit).map((item) => item.row);
  }

  /**
   * Captures the screen Julian is on: the identifying state keys, the scroll
   * positions, and the reader's own Document and trail when the reader is the
   * screen he leaves.
   */
  function returnPointFrom(state, scroll) {
    const copied = {};
    for (const key of RETURN_POINT_KEYS) copied[key] = state[key];
    const inReader = state.view === "document" && Boolean(state.document);
    return {
      state: copied,
      scroll,
      document: inReader
        ? { file: state.document.file, trail: [...(state.documentTrail ?? [])], trailIndex: Number(state.documentTrailIndex ?? -1) }
        : null,
    };
  }

  /** The Back button word for one return point; the Work desk without one. */
  function returnPointLabel(point, options) {
    if (!point) return "Work";
    const brain = Boolean(options && options.brain);
    const view = point.state?.view;
    if (view === "describe-agent") return brain ? "Brain" : "Agent";
    return RETURN_POINT_LABELS[view] ?? "Work";
  }

  const api = {
    RETURN_POINT_KEYS,
    normalizedSearchText, fileSlug, matchRows,
    returnPointFrom, returnPointLabel,
  };
export default api;

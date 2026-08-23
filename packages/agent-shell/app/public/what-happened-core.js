// The What happened look's shared facts (design contract:
// otto/tangent/design-done-goals-timeline, Decisions 2 through 4).
//
// Everything here is a pure function: the 12-hour window, the subtree
// filter, the closer's label, the moment label, and the won't-do reason
// extractor. The server and the browser both load it, the tests run it
// without a DOM. It is a plain script that registers a global, the same
// shape as area-map-core.js and go-to-core.js.
(function (root) {
  "use strict";

  /** The look's fixed reach: 12 hours, in milliseconds (Decision 4). */
  const CLOSE_WINDOW_MS = 43_200_000;

  /** The closes within `CLOSE_WINDOW_MS` of `now`, order preserved. */
  function windowCloses(closes, now) {
    return closes.filter((close) => close.at > now - CLOSE_WINDOW_MS);
  }

  /** The closes whose file lies inside `areaPath`'s subtree. */
  function areaCloses(closes, areaPath, isInside) {
    return closes.filter((close) => isInside(close.file.split("/").slice(0, -1).join("/"), areaPath));
  }

  /**
   * The printed name of whoever closed a Goal, from the close commit's
   * session. A brain session is `<areaLeaf>-brain`, `-g<N>` from generation
   * 2, `-r<k>` on a name collision (brain-record.mjs brainSessionName), for
   * any Area, so the match is on the suffix, not on one Area's leaf.
   */
  function closerLabel(session) {
    if (!session) return "Julian";
    const brain = session.match(/(?:^|-)brain(?:-g(\d+))?(?:-r\d+)?$/);
    if (brain) return brain[1] ? `brain g${brain[1]}` : "brain";
    return session.replace(/^tangent-/, "");
  }

  /** Zero-pads a number to two digits. */
  function twoDigits(value) {
    return String(value).padStart(2, "0");
  }

  /**
   * The printed time of a close: a bare `HH:MM` on the same local calendar
   * day as `now`, `yesterday HH:MM` otherwise. `timezoneOffset` is minutes,
   * as `Date.prototype.getTimezoneOffset` returns.
   */
  function closeMomentLabel(at, now, timezoneOffset) {
    const localAt = Math.floor(at / 60_000) - timezoneOffset;
    const localNow = Math.floor(now / 60_000) - timezoneOffset;
    const dayAt = Math.floor(localAt / 1440);
    const dayNow = Math.floor(localNow / 1440);
    const remainder = ((localAt % 1440) + 1440) % 1440;
    const time = `${twoDigits(Math.floor(remainder / 60))}:${twoDigits(remainder % 60)}`;
    return dayAt === dayNow ? time : `yesterday ${time}`;
  }

  /** The first non-empty line after the last `### Won't do` heading, "" without one. */
  function wontDoReason(text) {
    const marker = "### Won't do";
    const source = String(text ?? "");
    const at = source.lastIndexOf(marker);
    if (at === -1) return "";
    for (const line of source.slice(at + marker.length).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) return trimmed;
    }
    return "";
  }

  const api = {
    CLOSE_WINDOW_MS,
    windowCloses, areaCloses, closerLabel, closeMomentLabel, wontDoReason,
  };
  root.AgentShellWhatHappened = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

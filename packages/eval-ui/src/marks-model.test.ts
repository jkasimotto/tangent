import { describe, expect, it } from "vitest";
import { actionDisabled, kindLabel, markAge, repoLabel, sortMarksNewestFirst, statusChipClass, statusLabel, toEvalCommand, USAGE_APP_ROUTE } from "./marks-model.js";
import type { MarkRecord } from "./client.js";

/** Builds a minimal mark record for a test, filling in the fields marks-model helpers actually read. */
function mark(overrides: Partial<MarkRecord> = {}): MarkRecord {
  return {
    schema: "tangent.mark.v1",
    id: "20260705T143012-you-should-have-read",
    at: "2026-07-05T14:30:12.000Z",
    kind: "failure",
    anchor: { provider: "claude", sessionId: "session-1", conversationId: "claude:session-1", transcriptPath: "/home/user/.claude/projects/repo/session-1.jsonl" },
    repo: { root: "/Users/me/Projects/example" },
    observed: "greped for six minutes",
    status: "new",
    links: { eval: null, fix: null },
    ...overrides
  };
}

describe("toEvalCommand", () => {
  it("formats the copyable to-eval CLI command for a mark id", () => {
    expect(toEvalCommand("20260705T143012-read-docs-first")).toBe("tangent mark to-eval 20260705T143012-read-docs-first");
  });
});

describe("statusLabel / kindLabel / statusChipClass", () => {
  it("labels every known status", () => {
    expect(statusLabel("new")).toBe("new");
    expect(statusLabel("suggested")).toBe("suggested");
    expect(statusLabel("triaged")).toBe("triaged");
    expect(statusLabel("eval-created")).toBe("eval created");
    expect(statusLabel("fixed")).toBe("fixed");
    expect(statusLabel("dismissed")).toBe("dismissed");
  });

  it("labels the two kinds", () => {
    expect(kindLabel("failure")).toBe("failure");
    expect(kindLabel("candidate")).toBe("candidate");
  });

  it("builds a status-specific chip class, the only color-bearing class on a mark row", () => {
    expect(statusChipClass("fixed")).toBe("mark-status mark-status-fixed");
    expect(statusChipClass("dismissed")).toBe("mark-status mark-status-dismissed");
  });
});

describe("markAge", () => {
  const now = Date.parse("2026-07-05T14:40:00.000Z");

  it("reads as 'just now' for sub-minute ages", () => {
    expect(markAge("2026-07-05T14:39:45.000Z", now)).toBe("just now");
  });

  it("reads in minutes under an hour", () => {
    expect(markAge("2026-07-05T14:30:00.000Z", now)).toBe("10m ago");
  });

  it("reads in hours under a day", () => {
    expect(markAge("2026-07-05T10:00:00.000Z", now)).toBe("4h ago");
  });

  it("reads in days under a month", () => {
    expect(markAge("2026-07-01T14:40:00.000Z", now)).toBe("4d ago");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(markAge("not-a-date", now)).toBe("");
  });
});

describe("repoLabel", () => {
  it("returns the last path segment of the repo root", () => {
    expect(repoLabel("/Users/me/Projects/otto-tangent")).toBe("otto-tangent");
  });

  it("falls back to the whole value for a root with no path segments", () => {
    expect(repoLabel("")).toBe("");
  });
});

describe("actionDisabled", () => {
  it("disables an action whose target status matches the mark's current status", () => {
    expect(actionDisabled(mark({ status: "dismissed" }), "dismissed")).toBe(true);
    expect(actionDisabled(mark({ status: "new" }), "dismissed")).toBe(false);
  });
});

describe("sortMarksNewestFirst", () => {
  it("sorts by `at` descending", () => {
    const older = mark({ id: "older", at: "2026-07-01T00:00:00.000Z" });
    const newer = mark({ id: "newer", at: "2026-07-05T00:00:00.000Z" });
    expect(sortMarksNewestFirst([older, newer]).map((m) => m.id)).toEqual(["newer", "older"]);
  });
});

describe("USAGE_APP_ROUTE", () => {
  it("points at the shell's Usage app root (no per-conversation deep link exists there yet)", () => {
    expect(USAGE_APP_ROUTE).toBe("/usage");
  });
});

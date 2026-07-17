import os from "node:os";
import { git } from "@tangent/repo";
import { isoDate } from "./time.js";

/** A machine-checkable interpretation of a thread's prose wake condition; opaque means "only a human can decide". */
export type WakeCondition =
  | { kind: "date"; date: string; raw: string }
  | { kind: "merged"; branch: string; target: string; repoPath: string; raw: string }
  | { kind: "opaque"; raw: string };

/** Narrow git interface so wake evaluation is testable without a real repository. */
export type GitProbe = {
  isAncestor(repoPath: string, branch: string, target: string): Promise<boolean>;
  /** Alias with lifecycle terminology: true when branch is contained by its base. */
  isMerged?(repoPath: string, branch: string, base: string): Promise<boolean>;
};

const datePattern = /^wake on (\d{4}-\d{2}-\d{2})\b/i;
const mergedPattern = /^wake when (\S+) (?:is merged into|lands on) (\S+) in (\S+)/i;

/**
 * Classifies a wake-condition prose line into the small set of deterministically evaluable
 * shapes. Anything unrecognized stays opaque and keeps v1 behavior (listed as parked, woken
 * only by a human), so prose freedom is preserved.
 */
export function parseWakeCondition(raw: string): WakeCondition {
  const date = raw.match(datePattern);
  if (date) return { kind: "date", date: date[1]!, raw };
  const merged = raw.match(mergedPattern);
  if (merged) {
    return {
      kind: "merged",
      branch: stripTrailingPunctuation(merged[1]!),
      target: stripTrailingPunctuation(merged[2]!),
      repoPath: expandHome(stripTrailingPunctuation(merged[3]!)),
      raw
    };
  }
  return { kind: "opaque", raw };
}

/** Strips trailing `.`, `,`, `;`, or `:` from a captured token, since wake lines are prose sentences and routinely end (or pause mid-clause) with one. */
function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,;:]+$/, "");
}

/**
 * Evaluates a parsed wake condition against the clock and local git state. Checks local refs
 * only (no fetch): the sweep must stay fast and side-effect free, and a stale local ref only
 * delays a wake, never fabricates one.
 */
export async function evaluateWakeCondition(condition: WakeCondition, now: Date, probe: GitProbe): Promise<boolean> {
  if (condition.kind === "date") return condition.date <= isoDate(now);
  if (condition.kind === "merged") return probe.isAncestor(condition.repoPath, condition.branch, condition.target);
  return false;
}

/** Real GitProbe backed by @tangent/repo; a missing repo or unknown ref means "not met". */
export class RepoGitProbe implements GitProbe {
  /**
   * True when branch's tip is already contained in target in the given repository. `git()` throws
   * on a non-zero exit (which `merge-base --is-ancestor` uses to signal "not an ancestor") and on
   * any other git failure (missing repo, unknown ref), so both cases collapse to "not met" here.
   */
  async isAncestor(repoPath: string, branch: string, target: string): Promise<boolean> {
    try {
      await git(repoPath, ["merge-base", "--is-ancestor", branch, target]);
      return true;
    } catch {
      return false;
    }
  }

  /** Lifecycle-named alias for the same local ancestor check. */
  async isMerged(repoPath: string, branch: string, base: string): Promise<boolean> {
    return this.isAncestor(repoPath, branch, base);
  }
}

/** Expands a leading ~ so wake lines can use home-relative repo paths. */
function expandHome(inputPath: string): string {
  return inputPath.startsWith("~") ? os.homedir() + inputPath.slice(1) : inputPath;
}

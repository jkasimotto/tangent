import { launchRef } from "./launch-environment.mjs";

/**
 * Resolves the complete immutable launch snapshot for one new brain attempt.
 * An explicit choice is registry-backed and applies only to this call. The
 * Area declaration remains the authority whenever no choice is supplied.
 */
export async function resolveBrainAttemptLaunch({ area, choice = null, expectedLaunch = "", launchCatalog }) {
  const overridden = choice !== null && choice !== undefined;
  const selected = overridden
    ? await launchCatalog.requested({ choice })
    : await launchCatalog.forBrain(area);
  if (selected?.error) {
    return {
      status: overridden ? 400 : 409,
      ...(overridden ? { code: "invalid-choice" } : {}),
      error: selected.error,
    };
  }
  if (!selected?.harness || !selected.command) {
    return {
      status: overridden ? 400 : 409,
      ...(overridden ? { code: "invalid-choice" } : {}),
      error: overridden ? "the Brain launch choice is incomplete" : `${area}: no brain launch is declared`,
    };
  }
  const accepted = launchCatalog.allowed ? await launchCatalog.allowed(area, selected) : selected;
  if (accepted.error) return { status: 403, ...accepted };
  const resolvedLaunch = {
    // Provider is stamped here, at launch time, so a later edit to the
    // registry cannot rewrite what this generation actually ran on.
    ref: { harness: accepted.harness, model: accepted.model ?? null, effort: accepted.effort ?? null, provider: accepted.provider ?? null },
    label: accepted.label || accepted.command,
    command: accepted.command,
    sourceArea: overridden ? null : selected.source ?? null,
    mode: overridden ? "override" : selected.via ?? "brain",
  };
  const selectedRef = launchRef(resolvedLaunch.ref);
  if (expectedLaunch && expectedLaunch !== selectedRef) {
    return {
      status: 409,
      code: "launch-changed",
      error: `the Brain launch changed to ${selectedRef}; review it before starting`,
      launch: resolvedLaunch,
    };
  }
  return resolvedLaunch;
}

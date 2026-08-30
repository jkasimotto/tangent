/**
 * Revalidates a brain attempt that was not present in the tmux snapshot
 * captured before its exact-Area lifecycle lock became available.
 */
export async function refreshBrainObservation({ session, observed = null, instanceId, expectedTarget = null, expectedArea = null, expectedGeneration = null, inspect }) {
  if (!session) return { observed: null, live: false, canJudgeAbsence: true, state: "none" };
  if (observed) {
    const exact = observed.owned === true
      && (!expectedTarget || observed.target === expectedTarget)
      && (!expectedArea || (observed.brain ?? observed.area) === expectedArea)
      && (!expectedGeneration || Number(observed.generation) === Number(expectedGeneration));
    return { observed: exact ? observed : null, live: exact, canJudgeAbsence: true, state: exact ? "snapshot" : "mismatch" };
  }
  const current = await inspect(session);
  if (current.state === "absent") {
    return { observed: null, live: false, canJudgeAbsence: true, state: "absent" };
  }
  if (current.state === "live" && current.instanceId === instanceId && (!expectedTarget || current.target === expectedTarget)) {
    return { observed: { name: session, owned: true }, live: true, canJudgeAbsence: true, state: "fresh" };
  }
  return {
    observed: null,
    live: false,
    canJudgeAbsence: false,
    state: current.state === "live" ? (current.instanceId !== instanceId ? (current.instanceId ? "foreign" : "legacy") : "mismatch") : "error",
  };
}

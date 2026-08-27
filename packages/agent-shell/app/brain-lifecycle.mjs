/**
 * Revalidates a brain attempt that was not present in the tmux snapshot
 * captured before its exact-Area lifecycle lock became available.
 */
export async function refreshBrainObservation({ session, observed = null, instanceId, inspect }) {
  if (!session) return { observed: null, live: false, canJudgeAbsence: true, state: "none" };
  if (observed) return { observed, live: observed.owned === true, canJudgeAbsence: true, state: "snapshot" };
  const current = await inspect(session);
  if (current.state === "absent") {
    return { observed: null, live: false, canJudgeAbsence: true, state: "absent" };
  }
  if (current.state === "live" && current.instanceId === instanceId) {
    return { observed: { name: session, owned: true }, live: true, canJudgeAbsence: true, state: "fresh" };
  }
  return {
    observed: null,
    live: false,
    canJudgeAbsence: false,
    state: current.state === "live" ? (current.instanceId ? "foreign" : "legacy") : "error",
  };
}

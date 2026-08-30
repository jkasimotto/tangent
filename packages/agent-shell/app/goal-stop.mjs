/** Resolves one fenced Goal stop to its exact live session. */
export function goalStopTarget(sessions, { goal, expectedSession, expectedTarget } = {}) {
  const file = String(goal ?? "").trim();
  const name = String(expectedSession ?? "").trim();
  const target = String(expectedTarget ?? "").trim();
  if (!file || !name || !target) return { status: 400, error: "goal, expectedSession, and expectedTarget are required" };
  const exact = sessions.find((session) => session.target === target);
  if (exact && (exact.name !== name || exact.goal !== file)) return { status: 409, error: "the selected tmux target belongs to different work; refresh and stop the intended agent" };
  return { status: 200, name, target };
}

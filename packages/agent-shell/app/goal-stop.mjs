/** Resolves one fenced Goal stop to its exact live session. */
export function goalStopTarget(sessions, { goal, expectedSession } = {}) {
  const file = String(goal ?? "").trim();
  const name = String(expectedSession ?? "").trim();
  if (!file || !name) return { status: 400, error: "goal and expectedSession are required" };
  const live = sessions.find((session) => session.name === name);
  if (!live || live.goal !== file) return { status: 409, error: "the selected Goal no longer owns that live session" };
  return { status: 200, name };
}

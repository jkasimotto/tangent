/**
 * Resolves audit provenance for a local command without turning identity into
 * permission. Live session facts win, while old brain attempts still retain
 * their logical Area for durable messages and audit records.
 */
export function commandActor(session, { sessions = [], brains = [] } = {}) {
  const name = String(session ?? "").trim();
  if (!name) return { session: null, area: null, role: "local-shell" };
  const live = sessions.find((item) => item.name === name) ?? null;
  const brain = brains.find((record) => brainSessions(record).has(name)) ?? null;
  return {
    session: name,
    area: live?.area ?? brain?.area ?? null,
    role: live
      ? live.kind === "goal" ? "worker" : live.kind ?? "local-session"
      : brain ? "brain" : "local-session",
  };
}

/**
 * Resolves an explicit Area path or a known current or historical brain
 * session to its logical Area inbox. Unknown text does not become an Area.
 */
export function areaInboxTarget(target, { areas = [], brains = [] } = {}) {
  const name = String(target ?? "").trim();
  if (!name) return null;
  if (areas.includes(name)) return { area: name, via: "area" };
  const brain = brains.find((record) => brainSessions(record).has(name));
  return brain ? { area: brain.area, via: "brain-session" } : null;
}

/** Every current and historical session name recorded for one logical brain. */
function brainSessions(record) {
  return new Set([
    record?.session,
    record?.currentAttemptId,
    ...(Array.isArray(record?.generations) ? record.generations.map((entry) => entry?.session) : []),
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
}

/** Selects one Brain presentation without owning its lifecycle. */
export function areaBrainPaneMode(brain, session) {
  if (session?.name) return { kind: "terminal", session: session.name };
  if (brain?.live) return { kind: "resuming" };
  return { kind: "start", resume: Boolean(brain) };
}

export default { areaBrainPaneMode };

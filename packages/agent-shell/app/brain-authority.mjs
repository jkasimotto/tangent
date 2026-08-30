/** Evaluates the exact fresh tmux identity that can prove one brain attempt live. */
export function brainAttemptAuthority(record, session, { instanceId, now = Date.now() } = {}) {
  const generation = (record?.generations ?? []).findLast?.((entry) => (
    entry?.generation === record?.generation
    && entry?.session === (record?.currentAttemptId ?? record?.session)
  )) ?? record?.generations?.at?.(-1) ?? null;
  const expected = {
    session: record?.currentAttemptId ?? record?.session ?? null,
    target: generation?.target ?? null,
    instanceId: generation?.instanceId ?? record?.instanceId ?? instanceId ?? null,
    area: record?.area ?? null,
    generation: Number(record?.generation) || null,
  };
  const observedAt = Number(session?.observation?.at ?? session?.observedAt ?? session?.at) || now;
  const evidence = {
    source: "fresh tmux observation",
    observedAt: new Date(observedAt).toISOString(),
    fresh: session?.fresh !== false && session?.observation?.fresh !== false,
    expected,
    observed: session ? {
      session: session.name ?? null, target: session.target ?? null, instanceId: session.instanceId ?? null,
      area: session.brain ?? session.area ?? null, kind: session.kind ?? null, generation: Number(session.generation) || null,
    } : null,
  };
  if (!session) return { live: false, state: "absent", evidence };
  if (!evidence.fresh) return { live: false, state: "stale", evidence };
  const exact = session.name === expected.session
    && (!expected.target || session.target === expected.target)
    && session.instanceId === expected.instanceId
    && session.kind === "brain"
    && (session.brain ?? session.area) === expected.area
    && Number(session.generation) === expected.generation;
  return { live: exact, state: exact ? "live" : "mismatch", evidence };
}

/** Returns the inactive or unknown state required when tmux does not prove life. */
export function inactiveBrainAuthorityState(authority, unread = []) {
  const expected = authority?.evidence?.expected ?? {};
  const capture = authority?.evidence?.observedAt ?? new Date().toISOString();
  const identity = `${expected.session ?? "unknown session"}${expected.target ? ` at ${expected.target}` : ""}`;
  const stale = authority?.state === "stale";
  return {
    word: stale ? "Brain unknown" : "Brain stopped",
    since: Date.parse(capture),
    owner: stale ? "tangent" : "none",
    evidence: {
      source: "tmux observation",
      text: stale
        ? `The tmux observation for ${identity} is stale (${capture}).`
        : `Fresh tmux evidence at ${capture} has no exact attempt ${identity}.`,
    },
    next: stale ? "Tangent waits for a fresh tmux observation." : unread.length ? `${unread.length} notes wait for repair.` : "Nothing needs Julian for the stopped brain itself.",
  };
}

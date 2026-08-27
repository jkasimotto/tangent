// Pure recovery events derived from durable Goal queues and passive pane
// observations. The server persists returned events through the brain inbox.

/**
 * Returns one stable notice when the current worker attempt is still bound to
 * a live tmux session whose harness has exited back to its shell.
 */
export function workerShellExitNotice(record, assignment, session) {
  if (assignment?.status !== "running" || !assignment.session || assignment.session !== session?.name || session.state !== "shell") return null;
  const attempt = [...(assignment.attempts ?? [])].reverse().find((item) => item?.session === assignment.session) ?? null;
  const attemptId = attempt?.id ?? assignment.startedAt ?? assignment.session;
  return {
    sourceId: `worker-shell:${record.goal}:${assignment.id ?? assignment.index}:${attemptId}`,
    text: `Goal ${record.slug}: step ${assignment.index} of ${(record.steps ?? record.assignments ?? []).length} (${assignment.label || "agent"}, session ${assignment.session}) exited to its shell. The tmux session and durable assignment remain intact. Recover it in place with tangent agent context ${assignment.session}; do not kill or replace it.`,
  };
}

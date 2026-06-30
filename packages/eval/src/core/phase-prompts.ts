/** Builds the system prompt instructing the agent to produce an implementation plan. */
export function planPrompt(task: string): string {
  return `You are planning an implementation for the following task.

Do not edit files.
Produce a concise implementation plan with:
- relevant files to inspect
- likely changes
- risks
- validation commands

Task:
${task.trim()}
`;
}

/** Builds the system prompt instructing the agent to implement the task, optionally incorporating a committed plan. */
export function implementationPrompt(task: string, plan?: string): string {
  if (!plan?.trim()) {
    return `Implement the task below.

Task:
${task.trim()}
`;
  }
  return `Implement the task below using the committed plan.

Task:
${task.trim()}

Plan:
${plan.trim()}
`;
}

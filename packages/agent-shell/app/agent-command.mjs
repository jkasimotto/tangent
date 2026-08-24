/** Pins a fresh Claude conversation to its default model unless explicit. */
export function withDefaultModel(command) {
  const value = String(command ?? "");
  const launchesClaude = value.split(/\s+/)[0]?.includes("claude");
  if (!launchesClaude || value.includes("--model")) return value;
  return `${value} --model default`;
}

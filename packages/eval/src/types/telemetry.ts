// Activity telemetry captured directly from an agent's stream-json output during a run. Headless
// `claude --print` writes no transcript the usage index can scan, so the runner records its own
// timestamped event stream here; the Eval UI builds the live activity flame from this sidecar.

export type EvalAgentEventKind = "assistant" | "tool" | "command" | "file";

export type EvalAgentEvent = {
  at: string;
  kind: EvalAgentEventKind;
  tokens: number;
};

export type EvalAgentTelemetry = {
  schema: "eval.agent-telemetry.v1";
  events: EvalAgentEvent[];
  tokensTotal?: number;
};

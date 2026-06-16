import { createHash } from "node:crypto";

import type { UsageJsonlLineV1 } from "./schema/usage-jsonl-v1.js";
import {
  type UsageActor,
  type UsageAvailability,
  type UsageContentMode,
  type UsageEventV3,
  type UsageEvidenceRef,
  type UsageMessage,
  type UsageMetrics,
  type UsageNativeRef,
  type UsageProviderCapabilities,
  type UsageSession,
  type UsageSourceRef,
  type UsageStep,
  type UsageStepKind,
  type UsageToolCall,
  type UsageToolResult,
  type UsageTurn,
  type UsageWarning,
  usageAvailability
} from "../schema/index.js";
import { toUsageEventV3 } from "./event-v3.js";
import { aggregateMetrics, aggregateTokenUsage } from "./metrics.js";
import { pathsForEvent } from "./path-facets.js";

export type UsageProjectionInput = {
  events: Array<UsageEventV3 | UsageJsonlLineV1>;
  contentMode?: UsageContentMode;
  warnings?: UsageWarning[];
  sources?: UsageSourceRef[];
  capabilities?: UsageProviderCapabilities[];
  index?: {
    kind: "sqlite" | "memory";
    path?: string;
    version?: string;
  };
};

export type UsageProjections = {
  schema: "tangent.usage.projections.v1";
  sessions: UsageSession[];
  turns: UsageTurn[];
  steps: UsageStep[];
  messages: UsageMessage[];
  toolCalls: UsageToolCall[];
  toolResults: UsageToolResult[];
  usageSamples: UsageStep[];
  rawEvents: UsageEventV3[];
  warnings: UsageWarning[];
  sources: UsageSourceRef[];
  capabilities: UsageProviderCapabilities[];
  index?: {
    kind: "sqlite" | "memory";
    path?: string;
    version?: string;
  };
};

type AnnotatedEvent = UsageEventV3 & {
  _order: number;
  _turnOrder?: number;
};

export function eventsToProjections(input: UsageProjectionInput | Array<UsageEventV3 | UsageJsonlLineV1>): UsageProjections {
  const args = Array.isArray(input) ? { events: input } : input;
  const contentMode = args.contentMode || "metadata-with-excerpts";
  const events = annotateTurns(args.events.map((event, index) => toUsageEventV3(event, index, contentMode)).sort(compareEvents));
  const sessions = projectSessions(events, args.capabilities || []);
  const turns = projectTurns(events);
  const steps = projectSteps(events);
  const messages = projectMessages(events, steps, contentMode);
  const toolResults = projectToolResults(events, steps);
  const toolCalls = projectToolCalls(events, steps, toolResults);
  attachToolResultSteps(steps, toolCalls);
  attachMessageTokens(messages, events);
  computeStepSelfDurations(steps);

  return {
    schema: "tangent.usage.projections.v1",
    sessions: refreshSessionCounts(sessions, turns, steps, messages),
    turns,
    steps,
    messages,
    toolCalls,
    toolResults,
    usageSamples: steps.filter((step) => step.kind === "model_call" && step.metrics.tokens),
    rawEvents: events,
    warnings: args.warnings || [],
    sources: args.sources?.length ? args.sources : sourceRefs(events),
    capabilities: args.capabilities || [],
    index: args.index || { kind: "memory", version: "usage.memory.v1" }
  };
}

function projectSessions(events: AnnotatedEvent[], capabilities: UsageProviderCapabilities[]): UsageSession[] {
  return [...groupBy(events, (event) => event.scope.sessionId).entries()].map(([sessionId, rows]) => {
    const first = rows[0]!;
    const start = rows.find((event) => event.kind === "session.start") || first;
    const end = [...rows].reverse().find((event) => event.kind === "session.end");
    const last = rows.at(-1)!;
    const firstPrompt = rows.find((event) => event.kind === "message" && messageRole(event) === "user");
    const providerCoverage = Object.fromEntries(capabilities.filter((capability) => capability.provider === first.provider).flatMap((capability) => Object.entries(capability.fields)));
    const availability = usageAvailability({
      confidence: confidenceForRows(rows),
      notes: unique(rows.flatMap((event) => event.availability.notes)),
      providerCoverage
    });
    const repo = objectValue(first.providerFields?.repo);
    const git = objectValue(repo?.git);
    return {
      schema: "tangent.usage.session.v1" as const,
      id: sessionId,
      provider: first.provider,
      providerSessionId: first.scope.providerSessionId,
      title: stringValue(first.providerFields?.conversation && objectValue(first.providerFields.conversation)?.title) || textPreview(firstPrompt),
      firstPrompt: textValue(firstPrompt),
      summary: stringValue(first.providerFields?.conversation && objectValue(first.providerFields.conversation)?.summary),
      repo: {
        root: stringValue(repo?.root),
        rootHash: stringValue(repo?.root_hash),
        cwd: stringValue(repo?.cwd),
        branch: stringValue(git?.branch),
        headSha: stringValue(git?.head_sha),
        worktree: stringValue(git?.worktree)
      },
      cwd: stringValue(repo?.cwd),
      gitBranch: stringValue(git?.branch),
      relationship: "unknown" as const,
      startedAt: eventTime(start),
      endedAt: end ? eventTime(end) : undefined,
      lastActivityAt: eventTime(last),
      status: sessionStatus(rows, end),
      counts: emptyCounts(),
      metrics: aggregateMetrics(rows.map(eventMetrics)),
      availability,
      evidence: evidenceForRows(rows),
      providerFields: {
        providerSessionId: first.scope.providerSessionId,
        sourcePath: first.source.path
      }
    };
  }).sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""));
}

function projectTurns(events: AnnotatedEvent[]): UsageTurn[] {
  const turnRows = events.filter((event) => event.scope.turnId);
  return [...groupBy(turnRows, (event) => `${event.scope.sessionId}:${event.scope.turnId}`).entries()].map(([, rows]) => {
    const first = rows[0]!;
    const start = rows.find((event) => event.kind === "turn.start") || rows.find((event) => event.kind === "message" && messageRole(event) === "user") || first;
    const end = [...rows].reverse().find((event) => event.kind === "turn.end");
    const last = rows.at(-1)!;
    const order = first._turnOrder || 1;
    const title = rows.find((event) => event.kind === "message" && messageRole(event) === "user");
    return {
      schema: "tangent.usage.turn.v1" as const,
      id: first.scope.turnId!,
      sessionId: first.scope.sessionId,
      provider: first.provider,
      order,
      startedAt: eventTime(start),
      endedAt: end ? eventTime(end) : undefined,
      lastActivityAt: eventTime(last),
      status: turnStatus(end),
      titlePreview: textPreview(title),
      sourceFingerprint: stableId(JSON.stringify({ ids: rows.map((event) => event.id), latest: last.id })).slice(0, 16),
      metrics: aggregateMetrics(rows.map(eventMetrics)),
      evidence: evidenceForRows(rows),
      providerFields: { sourcePath: first.source.path }
    };
  }).sort((a, b) => (a.startedAt || a.lastActivityAt || "").localeCompare(b.startedAt || b.lastActivityAt || ""));
}

function projectSteps(events: AnnotatedEvent[]): UsageStep[] {
  const steps: UsageStep[] = [];
  const sessionSteps = new Map<string, string>();
  const turnSteps = new Map<string, string>();

  for (const [sessionId, rows] of groupBy(events, (event) => event.scope.sessionId)) {
    const first = rows[0]!;
    const last = rows.at(-1)!;
    const stepId = `step:${sessionId}:session`;
    sessionSteps.set(sessionId, stepId);
    steps.push({
      schema: "tangent.usage.step.v1",
      id: stepId,
      sessionId,
      order: -2,
      kind: "session",
      label: `${first.provider} session`,
      status: sessionStatus(rows, rows.find((event) => event.kind === "session.end")) === "failed" ? "error" : "unknown",
      provider: first.provider,
      startedAt: eventTime(rows.find((event) => event.kind === "session.start") || first),
      endedAt: eventTime([...rows].reverse().find((event) => event.kind === "session.end") || last),
      durationMs: durationBetween(eventTime(rows.find((event) => event.kind === "session.start") || first), eventTime([...rows].reverse().find((event) => event.kind === "session.end") || last)),
      durationConfidence: rows.some((event) => event.kind === "session.end") ? "derived" : "estimated",
      metrics: aggregateMetrics(rows.map(eventMetrics)),
      targetPaths: unique(rows.flatMap(pathsForEvent)),
      evidence: evidenceForRows(rows),
      nativeRefs: rows.map(nativeRef).filter(isDefined)
    });
  }

  for (const [key, rows] of groupBy(events.filter((event) => event.scope.turnId), (event) => `${event.scope.sessionId}:${event.scope.turnId}`)) {
    const first = rows[0]!;
    const last = rows.at(-1)!;
    const stepId = `step:${key}:turn`;
    turnSteps.set(key, stepId);
    const startedAt = eventTime(rows.find((event) => event.kind === "turn.start") || first);
    const endedAt = eventTime([...rows].reverse().find((event) => event.kind === "turn.end") || last);
    steps.push({
      schema: "tangent.usage.step.v1",
      id: stepId,
      sessionId: first.scope.sessionId,
      turnId: first.scope.turnId,
      parentStepId: sessionSteps.get(first.scope.sessionId),
      order: (first._turnOrder || 1) * 100000,
      kind: "turn",
      label: textPreview(rows.find((event) => event.kind === "message" && messageRole(event) === "user")) || "Turn",
      status: turnStatus([...rows].reverse().find((event) => event.kind === "turn.end")) === "failed" ? "error" : "unknown",
      provider: first.provider,
      startedAt,
      endedAt,
      durationMs: durationBetween(startedAt, endedAt),
      durationConfidence: rows.some((event) => event.kind === "turn.end") ? "derived" : "estimated",
      metrics: aggregateMetrics(rows.map(eventMetrics)),
      targetPaths: unique(rows.flatMap(pathsForEvent)),
      evidence: evidenceForRows(rows),
      nativeRefs: rows.map(nativeRef).filter(isDefined)
    });
  }

  for (const event of events) {
    if (event.kind === "session.start" || event.kind === "session.end" || event.kind === "turn.start" || event.kind === "turn.end") continue;
    const stepId = event.scope.stepId || `step:${event.scope.sessionId}:${event.id}`;
    const kind = stepKind(event);
    const startedAt = event.time?.startedAt || eventTime(event);
    const endedAt = event.time?.endedAt;
    const durationMs = event.time?.durationMs ?? event.data.tool?.durationMs ?? durationBetween(startedAt, endedAt);
    steps.push({
      schema: "tangent.usage.step.v1",
      id: stepId,
      sessionId: event.scope.sessionId,
      turnId: event.scope.turnId,
      parentStepId: parentStepId(event, kind, turnSteps, sessionSteps),
      order: event._order,
      kind,
      label: stepLabel(event, kind),
      category: event.data.tool?.category || fileCategory(event),
      status: statusForEvent(event),
      provider: event.provider,
      actor: event.actor,
      model: event.actor?.model || event.data.model,
      toolName: event.data.tool?.name,
      subagentId: event.scope.subagentId,
      startedAt,
      endedAt,
      durationMs,
      durationConfidence: durationMs !== undefined ? (event.time?.durationMs || event.data.tool?.durationMs ? "provider-reported" : "derived") : "unknown",
      metrics: {
        ...eventMetrics(event),
        durationMs,
        selfDurationMs: durationMs
      },
      targetPaths: pathsForEvent(event),
      evidence: [evidenceForEvent(event)],
      nativeRefs: [nativeRef(event)].filter(isDefined),
      providerFields: event.providerFields
    });
  }

  linkToolResultSteps(steps, events);
  return steps.sort((a, b) => a.order - b.order || (a.startedAt || "").localeCompare(b.startedAt || ""));
}

function projectMessages(events: AnnotatedEvent[], steps: UsageStep[], contentMode: UsageContentMode): UsageMessage[] {
  const messageEvents = events.filter((event) => event.kind === "message");
  const stepIndex = indexStepsByEvent(steps);
  const toolUseByMessage = new Set(events
    .filter((event) => event.kind === "tool.call" && event.scope.messageId)
    .map((event) => `${event.scope.sessionId}:${event.scope.messageId}`));
  const bySession = new Map<string, number>();
  return messageEvents.map((event) => {
    const ordinal = (bySession.get(event.scope.sessionId) || 0) + 1;
    bySession.set(event.scope.sessionId, ordinal);
    const text = contentMode === "metadata-only" ? undefined : event.data.text;
    const textPreviewValue = event.data.textPreview || preview(text);
    const id = event.scope.messageId || `msg:${event.scope.sessionId}:${ordinal}`;
    const step = stepIndex.get(event.id);
    const role = normalizeMessageRole(messageRole(event));
    return {
      schema: "tangent.usage.message.v1",
      id,
      sessionId: event.scope.sessionId,
      turnId: event.scope.turnId,
      stepId: step?.id,
      role,
      ordinal,
      createdAt: eventTime(event),
      text,
      textPreview: textPreviewValue,
      textChars: text ? Array.from(text).length : textPreviewValue ? Array.from(textPreviewValue).length : undefined,
      textBytes: text ? Buffer.byteLength(text, "utf8") : textPreviewValue ? Buffer.byteLength(textPreviewValue, "utf8") : undefined,
      contentMode,
      model: event.actor?.model || event.data.model,
      hasToolUse: toolUseByMessage.has(`${event.scope.sessionId}:${id}`),
      hasThinking: Boolean(event.data.thinkingSummary || event.data.summary || event.data.encrypted_content_present),
      thinkingSummary: stringValue(field(event.data, "thinkingSummary")) || stringValue(field(event.data, "summary")),
      confidence: event.availability.confidence,
      evidence: [evidenceForEvent(event)],
      providerFields: event.providerFields
    };
  });
}

function projectToolCalls(events: AnnotatedEvent[], steps: UsageStep[], results: UsageToolResult[]): UsageToolCall[] {
  const stepIndex = indexStepsByEvent(steps);
  const resultByToolCallId = new Map<string, UsageToolResult>();
  for (const result of results) {
    if (result.toolCallId && !resultByToolCallId.has(result.toolCallId)) resultByToolCallId.set(result.toolCallId, result);
  }
  return events.filter((event) => event.kind === "tool.call").map((event) => {
    const id = event.scope.toolCallId || event.data.tool?.id || `tool:${event.id}`;
    const step = stepIndex.get(event.id);
    const result = resultByToolCallId.get(id);
    return {
      schema: "tangent.usage.tool_call.v1",
      id,
      sessionId: event.scope.sessionId,
      turnId: event.scope.turnId,
      stepId: step?.id,
      messageId: event.scope.messageId,
      provider: event.provider,
      toolName: event.data.tool?.name || "unknown",
      category: event.data.tool?.category || "other",
      input: event.data.tool?.input,
      targetPaths: pathsForEvent(event),
      model: event.actor?.model || event.data.model,
      status: result?.status || "unknown",
      resultStepId: result?.stepId,
      result,
      evidence: [evidenceForEvent(event), ...(result?.evidence || [])],
      providerFields: event.providerFields
    };
  });
}

function projectToolResults(events: AnnotatedEvent[], steps: UsageStep[]): UsageToolResult[] {
  const stepIndex = indexStepsByEvent(steps);
  return events.filter((event) => event.kind === "tool.result").map((event) => {
    const step = stepIndex.get(event.id);
    return {
      schema: "tangent.usage.tool_result.v1",
      id: `tool-result:${event.id}`,
      sessionId: event.scope.sessionId,
      turnId: event.scope.turnId,
      stepId: step?.id,
      toolCallId: event.scope.toolCallId || event.data.tool?.id,
      provider: event.provider,
      toolName: event.data.tool?.name,
      status: statusForEvent(event),
      output: event.data.tool?.output,
      outputPreview: previewUnknown(event.data.tool?.output),
      durationMs: event.data.tool?.durationMs,
      evidence: [evidenceForEvent(event)],
      providerFields: event.providerFields
    };
  });
}

function refreshSessionCounts(sessions: UsageSession[], turns: UsageTurn[], steps: UsageStep[], messages: UsageMessage[]): UsageSession[] {
  const turnsBySession = groupBy(turns, (turn) => turn.sessionId);
  const stepsBySession = groupBy(steps, (step) => step.sessionId);
  const messagesBySession = groupBy(messages, (message) => message.sessionId);
  return sessions.map((session) => {
    const sessionMessages = messagesBySession.get(session.id) || [];
    const sessionSteps = stepsBySession.get(session.id) || [];
    const files = new Set(sessionSteps.flatMap((step) => step.targetPaths));
    return {
      ...session,
      counts: {
        turns: (turnsBySession.get(session.id) || []).length,
        messages: sessionMessages.length,
        userMessages: sessionMessages.filter((message) => message.role === "user").length,
        assistantMessages: sessionMessages.filter((message) => message.role === "assistant").length,
        toolCalls: sessionSteps.filter((step) => step.kind === "tool_call").length,
        subagents: sessionSteps.filter((step) => step.kind === "subagent").length,
        compactions: sessionSteps.filter((step) => step.kind === "compaction").length,
        filesTouched: files.size
      },
      metrics: aggregateMetrics(sessionSteps.map((step) => step.metrics))
    };
  });
}

function annotateTurns(events: UsageEventV3[]): AnnotatedEvent[] {
  const state = new Map<string, { current?: string; counter: number; indexes: Map<string, number> }>();
  return events.map((event, index) => {
    const row = state.get(event.scope.sessionId) || { counter: 0, indexes: new Map<string, number>() };
    let turnId = event.scope.turnId;
    const turnScoped = event.kind !== "session.start" && event.kind !== "session.end";
    if ((event.kind === "turn.start" || (event.kind === "message" && messageRole(event) === "user" && !row.current)) && !turnId) {
      row.counter += 1;
      turnId = `turn-${String(row.counter).padStart(6, "0")}`;
      row.current = turnId;
    } else if (turnId) {
      row.current = turnId;
    } else if (turnScoped) {
      turnId = row.current || "turn-000001";
      row.current = turnId;
    }
    if (turnId && !row.indexes.has(turnId)) row.indexes.set(turnId, row.indexes.size + 1);
    if (event.kind === "turn.end") row.current = undefined;
    state.set(event.scope.sessionId, row);
    return {
      ...event,
      scope: { ...event.scope, turnId },
      _order: index + 1,
      _turnOrder: turnId ? row.indexes.get(turnId) : undefined
    };
  });
}

function linkToolResultSteps(steps: UsageStep[], events: AnnotatedEvent[]): void {
  const callStepById = new Map<string, UsageStep>();
  const stepIndex = indexStepsByEvent(steps);
  for (const event of events) {
    if (event.kind !== "tool.call") continue;
    const step = stepIndex.get(event.id);
    const id = event.scope.toolCallId || event.data.tool?.id;
    if (id && step) callStepById.set(id, step);
  }
  for (const event of events) {
    if (event.kind !== "tool.result") continue;
    const resultStep = stepIndex.get(event.id);
    const callId = event.scope.toolCallId || event.data.tool?.id;
    const callStep = callId ? callStepById.get(callId) : undefined;
    if (resultStep && callStep) resultStep.parentStepId = callStep.id;
    if (callStep && resultStep?.durationMs !== undefined && callStep.durationMs === undefined) {
      callStep.durationMs = resultStep.durationMs;
      callStep.selfDurationMs = resultStep.durationMs;
      callStep.metrics.durationMs = resultStep.durationMs;
      callStep.metrics.selfDurationMs = resultStep.durationMs;
      callStep.durationConfidence = resultStep.durationConfidence;
    }
  }
}

function indexStepsByEvent(steps: UsageStep[]): Map<string, UsageStep> {
  const result = new Map<string, UsageStep>();
  for (const step of steps) {
    for (const evidence of step.evidence) {
      const current = result.get(evidence.eventId);
      if (!current || stepSpecificity(step) > stepSpecificity(current)) result.set(evidence.eventId, step);
    }
  }
  return result;
}

function stepSpecificity(step: UsageStep): number {
  if (step.kind === "session") return 0;
  if (step.kind === "turn") return 1;
  return 2;
}

function attachToolResultSteps(steps: UsageStep[], calls: UsageToolCall[]): void {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  for (const call of calls) {
    const step = call.stepId ? stepById.get(call.stepId) : undefined;
    const result = call.result?.stepId ? stepById.get(call.result.stepId) : undefined;
    if (step && result && step.durationMs === undefined && result.durationMs !== undefined) {
      step.durationMs = result.durationMs;
      step.selfDurationMs = result.durationMs;
      step.metrics.durationMs = result.durationMs;
      step.metrics.selfDurationMs = result.durationMs;
      step.durationConfidence = result.durationConfidence;
    }
  }
}

function attachMessageTokens(messages: UsageMessage[], events: AnnotatedEvent[]): void {
  const usageEvents = groupBy(events.filter((event) => event.data.usage && event.scope.messageId), (event) => `${event.scope.sessionId}:${event.scope.messageId}`);
  for (const message of messages) {
    const direct = usageEvents.get(`${message.sessionId}:${message.id}`) || [];
    if (direct.length) message.tokenUsage = aggregateTokenUsage(direct.map((event) => event.data.usage).filter(isDefined));
  }
}

function computeStepSelfDurations(steps: UsageStep[]): void {
  const children = groupBy(steps.filter((step) => step.parentStepId), (step) => step.parentStepId!);
  for (const step of steps) {
    if (step.durationMs === undefined) continue;
    const childDuration = (children.get(step.id) || []).reduce((sum, child) => sum + (child.durationMs || 0), 0);
    const self = Math.max(0, step.durationMs - childDuration);
    step.selfDurationMs = self;
    step.metrics.selfDurationMs = self;
  }
}

function parentStepId(event: AnnotatedEvent, kind: UsageStepKind, turnSteps: Map<string, string>, sessionSteps: Map<string, string>): string | undefined {
  if (event.scope.parentStepId) return event.scope.parentStepId;
  if (kind === "tool_result") return undefined;
  if (event.scope.turnId) return turnSteps.get(`${event.scope.sessionId}:${event.scope.turnId}`);
  return sessionSteps.get(event.scope.sessionId);
}

function eventMetrics(event: UsageEventV3): UsageMetrics {
  const text = event.data.text;
  const output = event.kind === "message" && messageRole(event) === "assistant" ? text : undefined;
  const input = event.kind === "message" && messageRole(event) === "user" ? text : undefined;
  const durationMs = event.time?.durationMs ?? event.data.tool?.durationMs;
  return {
    tokens: event.data.usage,
    cost: event.data.cost,
    durationMs,
    selfDurationMs: durationMs,
    inputChars: input ? Array.from(input).length : undefined,
    outputChars: output ? Array.from(output).length : undefined,
    inputBytes: input ? Buffer.byteLength(input, "utf8") : undefined,
    outputBytes: output ? Buffer.byteLength(output, "utf8") : undefined,
    count: 1
  };
}

function stepKind(event: UsageEventV3): UsageStepKind {
  if (event.kind === "message") {
    const role = messageRole(event);
    if (role === "user") return "user_message";
    if (role === "assistant") return "assistant_response";
    return "unknown";
  }
  if (event.kind === "model.call" || event.kind === "usage.sample") return "model_call";
  if (event.kind === "tool.call") {
    if (event.data.tool?.category === "command") return "command";
    return "tool_call";
  }
  if (event.kind === "tool.result") return "tool_result";
  if (event.kind === "compaction") return "compaction";
  if (event.kind === "permission") return "permission";
  if (event.kind === "file.event") {
    if (event.data.file?.operation === "read") return "file_read";
    if (event.data.file?.operation === "search") return "file_search";
    if (event.data.file?.operation === "write") return "file_write";
  }
  if (event.kind === "subagent.start" || event.kind === "subagent.end") return "subagent";
  if (event.kind === "error") return "error";
  return "unknown";
}

function stepLabel(event: UsageEventV3, kind: UsageStepKind): string {
  if (kind === "user_message") return "User message";
  if (kind === "assistant_response") return event.actor?.model ? `Assistant response (${event.actor.model})` : "Assistant response";
  if (kind === "model_call") return event.actor?.model || event.data.model || "Model call";
  if (kind === "tool_call" || kind === "command") return event.data.tool?.name || "Tool call";
  if (kind === "tool_result") return `${event.data.tool?.name || "Tool"} result`;
  if (kind === "compaction") return "Compaction";
  if (kind === "permission") return "Permission";
  if (kind === "subagent") return "Subagent";
  return event.kind;
}

function statusForEvent(event: UsageEventV3): "success" | "error" | "cancelled" | "unknown" {
  const status = event.data.tool?.status || stringValue(field(event.data, "status"));
  if (event.kind === "error" || status === "error" || Boolean(event.data.error)) return "error";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "success" || status === "completed") return "success";
  return "unknown";
}

function sessionStatus(events: UsageEventV3[], end: UsageEventV3 | undefined): UsageSession["status"] {
  if (events.some((event) => event.kind === "error")) return "failed";
  if (end) return "completed";
  return "active";
}

function turnStatus(end: UsageEventV3 | undefined): UsageTurn["status"] {
  const status = stringValue(field(end?.data, "status"));
  if (status === "completed" || status === "failed") return status;
  return end ? "completed" : "unknown";
}

function evidenceForRows(rows: UsageEventV3[]): UsageEvidenceRef[] {
  return rows.map(evidenceForEvent);
}

function evidenceForEvent(event: UsageEventV3): UsageEvidenceRef {
  return {
    eventId: event.id,
    sourceId: event.source.id,
    native: nativeRef(event),
    confidence: event.availability.confidence
  };
}

function nativeRef(event: UsageEventV3): UsageNativeRef | undefined {
  if (!event.source.path && !event.source.rawHash && !event.source.line && !event.source.jsonPointer) return undefined;
  return {
    sourcePath: event.source.path,
    line: event.source.line,
    jsonPointer: event.source.jsonPointer,
    rawHash: event.source.rawHash,
    providerType: stringValue(field(event.providerFields, "legacyKind")) || stringValue(field(objectValue(event.providerFields?.native), "providerType"))
  };
}

function sourceRefs(events: UsageEventV3[]): UsageSourceRef[] {
  const rows = new Map<string, UsageSourceRef>();
  for (const event of events) {
    rows.set(event.source.id, {
      id: event.source.id,
      provider: event.provider,
      kind: event.source.kind,
      path: event.source.path,
      rawHash: event.source.rawHash
    });
  }
  return [...rows.values()];
}

function compareEvents(left: UsageEventV3, right: UsageEventV3): number {
  return (eventTime(left) || "").localeCompare(eventTime(right) || "") || left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id);
}

function messageRole(event: UsageEventV3): string {
  return stringValue(event.data.role) || event.actor?.role || "assistant";
}

function normalizeMessageRole(role: string): UsageMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "assistant";
}

function fileCategory(event: UsageEventV3): string | undefined {
  if (event.kind !== "file.event") return undefined;
  return event.data.file?.operation;
}

function confidenceForRows(rows: UsageEventV3[]): UsageAvailability["confidence"] {
  const values = rows.map((event) => event.availability.confidence);
  if (values.includes("estimated") || values.includes("partial")) return "partial";
  if (values.includes("derived")) return "derived";
  if (values.includes("provider-reported")) return "provider-reported";
  if (values.includes("exact")) return "exact";
  return "unknown";
}

function eventTime(event: UsageEventV3 | undefined): string | undefined {
  return event?.observedAt || event?.recordedAt || event?.time?.startedAt;
}

function durationBetween(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return undefined;
  return Math.max(0, ended - started);
}

function textValue(event: UsageEventV3 | undefined): string | undefined {
  return event?.data.text || event?.data.textPreview;
}

function textPreview(event: UsageEventV3 | undefined): string | undefined {
  return event?.data.textPreview || preview(event?.data.text);
}

function preview(value: unknown, length = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > length ? `${singleLine.slice(0, length - 1)}...` : singleLine;
}

function previewUnknown(value: unknown, length = 1000): string | undefined {
  if (typeof value === "string") return preview(value, length);
  if (value === undefined) return undefined;
  return preview(JSON.stringify(value), length);
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emptyCounts(): UsageSession["counts"] {
  return { turns: 0, messages: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, subagents: 0, compactions: 0, filesTouched: 0 };
}

function groupBy<T, K>(values: T[], keyFn: (value: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const rows = map.get(key) || [];
    rows.push(value);
    map.set(key, rows);
  }
  return map;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value): value is T & {} => value !== undefined && value !== null))];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

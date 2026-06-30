import type { UsageCost, UsageMetrics, UsageTokenUsage } from "../schema/index.js";

/** Sums an array of UsageMetrics records into a single aggregate object. */
export function aggregateMetrics(values: UsageMetrics[]): UsageMetrics {
  const tokens = aggregateTokenUsage(values.map((value) => value.tokens).filter(isDefined));
  const cost = aggregateCost(values.map((value) => value.cost).filter(isDefined));
  return stripUndefined({
    tokens,
    cost,
    durationMs: sum(values.map((value) => value.durationMs)),
    selfDurationMs: sum(values.map((value) => value.selfDurationMs)),
    inputChars: sum(values.map((value) => value.inputChars)),
    outputChars: sum(values.map((value) => value.outputChars)),
    inputBytes: sum(values.map((value) => value.inputBytes)),
    outputBytes: sum(values.map((value) => value.outputBytes)),
    count: sum(values.map((value) => value.count))
  });
}

/** Sums an array of token usage records into one, taking the max for context window fields. */
export function aggregateTokenUsage(values: UsageTokenUsage[]): UsageTokenUsage | undefined {
  if (!values.length) return undefined;
  return stripUndefined({
    input: sum(values.map((value) => value.input)),
    output: sum(values.map((value) => value.output)),
    total: sum(values.map((value) => value.total ?? sum([value.input, value.output, value.cacheRead, value.cacheCreation, value.reasoning]))),
    cacheRead: sum(values.map((value) => value.cacheRead)),
    cacheCreation: sum(values.map((value) => value.cacheCreation)),
    reasoning: sum(values.map((value) => value.reasoning)),
    context: max(values.map((value) => value.context)),
    peakContext: max(values.map((value) => value.peakContext)),
    source: values.every((value) => value.source === "provider-reported") ? "provider-reported" as const : "derived" as const,
    confidence: values.every((value) => value.confidence === "provider-reported") ? "provider-reported" as const : "derived" as const
  });
}

/** Sums an array of cost records into one aggregate cost value. */
function aggregateCost(values: UsageCost[]): UsageCost | undefined {
  if (!values.length) return undefined;
  const unpriced = unique(values.flatMap((value) => value.unpricedModels || []));
  return {
    amount: sum(values.map((value) => value.amount)),
    currency: "USD",
    source: values.every((value) => value.source === "provider-reported") ? "provider-reported" : values.every((value) => value.source === "pricing-plugin") ? "pricing-plugin" : "estimated",
    priced: values.every((value) => value.priced),
    unpricedModels: unpriced.length ? unpriced : undefined
  };
}

/** Returns a copy of the object with all undefined-valued keys omitted. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** Sums all defined finite numbers in the array, returning undefined if none are present. */
function sum(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!present.length) return undefined;
  return present.reduce((total, value) => total + value, 0);
}

/** Returns the maximum of all defined finite numbers in the array, or undefined if the array is empty. */
function max(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? Math.max(...present) : undefined;
}

/** Returns a new array with duplicate and nullish values removed. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value): value is T & {} => value !== undefined && value !== null))];
}

/** Returns true if the value is not undefined. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

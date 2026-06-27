/** Structured-output contract the correction judge must return for one conversation. */
export const correctionMetricsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correctionCount", "corrections"],
  properties: {
    correctionCount: { type: "integer", minimum: 0 },
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "why"],
        properties: {
          quote: { type: "string" },
          why: { type: "string" }
        }
      }
    }
  }
};

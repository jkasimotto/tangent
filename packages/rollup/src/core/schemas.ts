export const rollupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "markdown", "sourceCaveats"],
  properties: {
    schema: { const: "rollup.output.v1" },
    markdown: { type: "string" },
    sourceCaveats: { type: "array", items: { type: "string" } }
  }
};

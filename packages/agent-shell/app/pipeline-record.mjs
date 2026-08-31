// One-release compatibility edge. Runtime code and old tests can continue to
// import the retired Pipeline names, but job-record.mjs is the sole record
// implementation and durable authority.
export * from "./job-record.mjs";

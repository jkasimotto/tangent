export type SearchEngine = "ts" | "rust";

export function resolveEngine(value?: string): SearchEngine {
  const selected = value || process.env.TANGENT_SEARCH_ENGINE || "ts";
  if (selected === "ts" || selected === "rust") return selected;
  throw new Error("search engine must be ts or rust.");
}

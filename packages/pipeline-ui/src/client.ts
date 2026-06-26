export type PipelineFeatureSummary = {
  slug: string;
  title: string;
  status: string;
  /** Newest-first sort key from the server; never rendered. */
  updatedAt: string;
};

export type PipelineScope = {
  slug: string;
  title: string;
  status: string;
  realProblem: string;
  proposedDesign: string;
};

export type PipelineUiClient = {
  loadFeatures(): Promise<PipelineFeatureSummary[]>;
  loadScope(slug: string): Promise<PipelineScope>;
};

/** Creates a browser client backed by the local Designs HTTP API. */
export function createPipelineApiClient(basePath = "/api/pipeline"): PipelineUiClient {
  return {
    /** Loads the feature list (newest-first) from the Designs API. */
    async loadFeatures() {
      const value = await requestJson(`${basePath}/features`) as { features?: unknown };
      return Array.isArray(value.features) ? value.features as PipelineFeatureSummary[] : [];
    },
    /** Loads one feature's parsed scope from the Designs API. */
    async loadScope(slug) {
      return requestJson(`${basePath}/features/${encodeURIComponent(slug)}/scope`) as Promise<PipelineScope>;
    }
  };
}

/** A seeded scope plus the sort key the server would supply; `updatedAt` drives newest-first order. */
export type MemoryPipelineSeed = PipelineScope & { updatedAt?: string };

/** Creates an in-memory Designs client for local previews and component tests. */
export function createMemoryPipelineClient(seed: MemoryPipelineSeed[] = []): PipelineUiClient {
  const scopes = seed.map((scope) => ({ ...scope }));
  return {
    /** Lists the seeded features as summaries, newest-first by updatedAt. */
    async loadFeatures() {
      return scopes
        .map((scope) => ({ slug: scope.slug, title: scope.title, status: scope.status, updatedAt: scope.updatedAt ?? "" }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    /** Returns one seeded feature's scope, throwing if the slug is unknown. */
    async loadScope(slug) {
      const scope = scopes.find((candidate) => candidate.slug === slug);
      if (!scope) throw new Error(`No scope for feature: ${slug}`);
      return { slug: scope.slug, title: scope.title, status: scope.status, realProblem: scope.realProblem, proposedDesign: scope.proposedDesign };
    }
  };
}

/** Requests and parses a JSON response, surfacing a useful error message on failure. */
async function requestJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

/** Reads a useful error message from a failed API response. */
async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Fall back to the raw response text below.
  }
  if (text.includes("<!doctype") || text.includes("<html")) return "Designs API unavailable. Start the app through `tangent ui`.";
  return text.trim() || `Designs API request failed with ${response.status}.`;
}

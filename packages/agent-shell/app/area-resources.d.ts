/** One Area note's `## Resources` lines. A missing line is null. */
export type AreaResources = { repository: string | null; worktree: string | null; branch: string | null };

/** One resource value with the Area whose note declares it. */
export type DescribedResource = { value: string; area: string };

/** The folder a worker starts in and the Area or step that chose it. */
export type WorkFolder = { cwd: string; source: string; branch: string | null };

export const AREA_RESOURCE_LABELS: readonly string[];

/** Parses the `## Resources` section of one Area note. */
export function parseAreaResources(noteText: string | null | undefined): AreaResources;

/** The absolute path of one Area's note inside the vault. */
export function areaNotePath(treesRoot: string, area: string): string;

/** The resources an Area sees, each with the Area that declares it. */
export function describeAreaResources(treesRoot: string, area: string): Promise<{ repository: DescribedResource | null; worktree: DescribedResource | null; branch: DescribedResource | null }>;

/** The resource values an Area sees, nearest declaration first. */
export function inheritedAreaResources(treesRoot: string, area: string): Promise<AreaResources>;

/** The folder a worker for this Area starts in, or null when nothing binds. */
export function resolveWorkFolder(treesRoot: string, area: string): Promise<WorkFolder | null>;

/** The refusal text for an Area that binds no folder. */
export function unboundAreaMessage(treesRoot: string, area: string, options?: { pathHint?: boolean }): string;

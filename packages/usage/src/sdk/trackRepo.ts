import type { UsageProvider } from "../core/schema/usage-jsonl-v1.js";
import { repoInfo } from "@tangent/repo";
import { setRepoTracked } from "../hook-runner/tracking-policy.js";

export type TrackRepoOptions = {
  repo: string;
  providers?: Array<UsageProvider | "all">;
};

export async function trackRepo(options: TrackRepoOptions): Promise<void> {
  const info = await repoInfo(options.repo);
  await setRepoTracked(info.root || info.cwd, true, options.providers || ["all"]);
}

export async function untrackRepo(options: TrackRepoOptions): Promise<void> {
  const info = await repoInfo(options.repo);
  await setRepoTracked(info.root || info.cwd, false, options.providers || ["all"]);
}

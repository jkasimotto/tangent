import { initConfig, loadConfig, setConfigValue, sharedConfigOnly, writeConfigFile, type InitSearchOptions } from "../core/config.js";

export type ConfigureOptions = InitSearchOptions | {
  repo: string;
  scope?: "private" | "global" | "repo-shared";
  set: {
    path: string;
    value: string;
  };
};

/** Configures. */
export async function configure(options: ConfigureOptions): Promise<{ path: string }> {
  if ("set" in options) {
    const loaded = await loadConfig({ repo: options.repo });
    const next = setConfigValue(loaded.config, options.set.path, options.set.value);
    const target = options.scope === "global" ? loaded.paths.globalConfigPath : options.scope === "repo-shared" ? loaded.paths.repoSharedConfigPath : loaded.paths.privateConfigPath;
    await writeConfigFile(target, options.scope === "repo-shared" ? sharedConfigOnly(next) : next);
    return { path: target };
  }
  const loaded = await initConfig(options);
  return { path: loaded.sources[0] || loaded.paths.privateConfigPath };
}

export { loadConfig, initConfig, defaultConfig } from "../core/config.js";

import { initConfig, loadConfig, setConfigValue, writeConfigFile, type InitRollupOptions } from "../core/config.js";

export type ConfigureOptions = InitRollupOptions | {
  repo: string;
  set: {
    path: string;
    value: string;
  };
};

export async function configure(options: ConfigureOptions): Promise<{ path: string }> {
  if ("set" in options) {
    const loaded = await loadConfig({ repo: options.repo });
    const next = setConfigValue(loaded.config, options.set.path, options.set.value);
    await writeConfigFile(loaded.paths.privateConfigPath, next);
    return { path: loaded.paths.privateConfigPath };
  }
  const loaded = await initConfig(options);
  return { path: loaded.paths.privateConfigPath };
}

export { loadConfig, initConfig, defaultConfig } from "../core/config.js";

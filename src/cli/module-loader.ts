export type ResolveModule = (specifier: string) => string | undefined | Promise<string | undefined>;
export type ImportModule = <T>(specifier: string) => Promise<T>;

export type OptionalModuleHooks = {
  resolveModule?: ResolveModule;
  importModule?: ImportModule;
};

/** Resolves an optional module without importing it. */
export async function resolveOptionalModule(specifier: string, hooks: OptionalModuleHooks = {}): Promise<string | undefined> {
  const resolveModule = hooks.resolveModule || defaultResolveModule;
  try {
    return await resolveModule(specifier);
  } catch (error) {
    if (isMissingPackageError(error, packageName(specifier))) return undefined;
    throw error;
  }
}

/** Imports a module only after confirming the package is present. */
export async function optionalModule<T>(specifier: string, hooks: OptionalModuleHooks = {}): Promise<T | undefined> {
  const resolved = await resolveOptionalModule(specifier, hooks);
  if (!resolved) return undefined;
  const importModule = hooks.importModule || defaultImportModule;
  return importModule<T>(resolved);
}

/** Imports an optional command dependency and throws a user-facing install error when absent. */
export async function requiredProductModule<T>(specifier: string, command: string): Promise<T> {
  const imported = await optionalModule<T>(specifier);
  if (imported) return imported;
  throw new Error(`The '${command}' command requires ${packageName(specifier)} to be installed.`);
}

/** Resolves a module specifier using the ESM resolver. */
function defaultResolveModule(specifier: string): string | undefined {
  return import.meta.resolve(specifier);
}

/** Imports a resolved module specifier. */
async function defaultImportModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

/** Returns the package name portion of a module specifier. */
function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] || specifier;
}

/** Tests whether an ESM resolver error means the package itself is absent. */
function isMissingPackageError(error: unknown, pkg: string): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ERR_MODULE_NOT_FOUND" && (
    message.includes(`Cannot find package '${pkg}'`) ||
    message.includes(`Cannot find package "${pkg}"`)
  );
}

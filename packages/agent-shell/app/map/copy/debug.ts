// The diagnostics table behind ?debug=area-map.

/** The words of the diagnostics aside. */
export const DEBUG = {
  name: "Area map diagnostics",
  title: "Area map diagnostics",
  dirtyOwners: "dirty owners: ",
  none: "none",
  columns: ["owner", "source", "runtime", "stored", "constraint", "load"] as readonly string[],
  authoredIdentities: "Authored identities",
  separator: " · ",
  /** One rectangle as "x,y width×height". */
  rect(x: string, y: string, width: string, height: string): string { return `${x},${y} ${width}×${height}`; },
} as const;

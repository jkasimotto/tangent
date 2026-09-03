// The details page of one resource inside the Resources panel.

/** The words of the details page. */
export const RESOURCE_DETAILS = {
  back: "← Back to resources",
  kind: "Kind",
  exactTarget: "Exact target",
  targetUnavailable: "Target unavailable",
  owningArea: "Owning Area",
  source: "Source",
  direct: "Direct",
  state: "State",
  current: "Current",
  map: "Map",
  branch: "Branch",
  repositoryPath: "Repository path",
  checked: "Checked",
  providerUpdated: "Provider updated",
  statusError: "Status error",
  launchDefault: "Workers start here by default",
  no: "No",
  legacyOrigin: "Legacy origin",
  warning: "Warning",
  stateSeparator: " · ",
  /** "From otto" for an inherited resource. */
  from(sourceArea: string): string { return `From ${sourceArea}`; },
  /** The launch binding answer when workers do start here. */
  launchYes(owner: string): string { return `Yes · Area launch binding ${owner}`; },
  /** The legacy origin field, with the declared Branch when there is one. */
  legacyOriginValue(field: string, declaredBranch: string | null): string { return `${field}${declaredBranch ? ` · Branch ${declaredBranch}` : ""}`; },
  /** The accessible name of a details action: the action, then the resource's facts. */
  actionName(label: string, accessibleName: string): string { return `${label}. ${accessibleName}`; },
} as const;

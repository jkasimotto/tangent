// The Resources panel: its header, transport problems, inventory groups and
// one inventory row.

/** Where a resource stands on the Map, as the panel and the picker say it. */
export type Representation = "on-map" | "hidden" | "never-placed" | "unavailable";

/** The panel chrome and inventory. */
export const RESOURCES_PANEL = {
  eyebrow: "Area resource inventory",
  close: "Close",
  breadcrumbName: "Resource Area breadcrumb",
  retry: "Retry",
  loading: "Loading Map resources…",
  couldNotRefresh: "Could not refresh Map resources · Last known.",
  didNotLoad: "Map resources did not load.",
  partial: "Some source facts are unavailable. Counts are lower bounds; Copy and Open remain available.",
  noMatch: "No resources match this filter.",
  empty: "No confirmed Map resources in this Area yet.",
  changeSaved: "Map resource change saved.",
  undo: "Undo",
  groups: { local: "Worktrees and repositories", links: "Links", removed: "Removed from Area", inherited: "From ancestor Areas" },
  /** The heading: "Map resources · Otto". */
  title(areaName: string): string { return `Map resources · ${areaName}`; },
  /** The Map state of one row, as the row and the details say it. */
  representationLabel(representation: Representation): string {
    return representation === "on-map" ? "On Map" : representation === "hidden" ? "Not on Map · Hidden" : representation === "never-placed" ? "Not on Map · Never placed" : "Map state unavailable";
  },
  /** The path-alias warning: another resource may point at the same place. */
  pathAliasWarning(otherId: string | null, otherOwner: string | null): string {
    return `Path may alias resource ${otherId ?? "unknown"} in ${otherOwner ?? "another Area"}.`;
  },
  /** The cross-kind warning: the same exact target is recorded under another kind. */
  crossKindWarning(otherOwner: string | null): string {
    return `The exact target is also recorded under another kind in ${otherOwner ?? "this Area"}.`;
  },
} as const;

/** One inventory row and its buttons. */
export const RESOURCE_ROW = {
  direct: "Direct",
  targetUnavailable: "Target unavailable",
  showOnMap: "Show on Map",
  restoreOnMap: "Restore on Map",
  placeOnMap: "Place on Map",
  details: "Details",
  hideBlock: "Hide Block",
  addBack: "Add back to Area",
  checking: "Checking",
  checkingBusy: "Checking…",
  checkPath: "Check path",
  refreshStatus: "Refresh status",
  refreshPath: "Refresh path",
  changeToRepository: "Change to Repository",
  edit: "Edit",
  remove: "Remove from Area",
  openSourceArea: "Open source Area",
  addToThisArea: "Add to this Area",
  launchDefault: "Workers start here by default",
  /** The provenance of an inherited row. */
  from(sourceArea: string): string { return `From ${sourceArea}`; },
  /** A second ancestor the same resource is also inherited from. */
  alsoFrom(area: string): string { return `Also from ${area}`; },
  /** The launch-binding warning under a row workers still start from. */
  launchWarning(owner: string): string { return `Workers still start here by default from the Area launch binding (${owner}).`; },
  /** Show or Place in the owning Area, by its leaf name, for an inherited row. */
  showIn(areaLeaf: string): string { return `Show in ${areaLeaf}`; },
  /** Place in the owning Area, by its leaf name, for an inherited row. */
  placeIn(areaLeaf: string): string { return `Place in ${areaLeaf}`; },
  /** The accessible name of the Open source Area button. */
  openSourceAreaName(owner: string): string { return `Open source Area ${owner}`; },
  /** The refresh button for one row: an unchecked path, a link, or a path. */
  refreshLabel(notChecked: boolean, isLink: boolean): string { return notChecked ? this.checkPath : isLink ? this.refreshStatus : this.refreshPath; },
  /** The placement button for one row. */
  placementLabel(representation: Representation, direct: boolean, ownerLeaf: string): string {
    if (representation === "on-map") return direct ? this.showOnMap : this.showIn(ownerLeaf);
    if (representation === "hidden") return this.restoreOnMap;
    return direct ? this.placeOnMap : this.placeIn(ownerLeaf);
  },
  /** The accessible name of one row: facts, provenance, Map state, launch binding, warnings. */
  name(parts: { accessibleName: string; provenance: string; representationLabel: string; launchOwner: string | null; warnings: readonly string[] }): string {
    const launch = parts.launchOwner ? ` Workers start here by default from ${parts.launchOwner}.` : "";
    const warnings = parts.warnings.length ? ` ${parts.warnings.join(" ")}` : "";
    return `${parts.accessibleName}. ${parts.provenance}. ${parts.representationLabel}.${launch}${warnings}`;
  },
  /** The accessible name of one row button: the action, then the whole row. */
  actionName(label: string, rowName: string): string { return `${label}. ${rowName}`; },
} as const;

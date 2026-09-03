// Every sentence a person reads on the Map, grouped by surface under
// `copy/`. Feature code imports from this file; the surfaces are split so no
// module passes 400 lines. `copyForFailure` turns a failure kind into words.

export type { KeyPart, KeyedText } from "./copy/keyed-text.ts";
export { key, keyedTextToString } from "./copy/keyed-text.ts";
export { TOOLBAR, KINDS } from "./copy/toolbar.ts";
export type { FoldWord, RuntimeVerb } from "./copy/area-labels.ts";
export { AREA_LABELS } from "./copy/area-labels.ts";
export { SAVE, DRAFT_CHOICE } from "./copy/save.ts";
export { FIND } from "./copy/find.ts";
export { PICKER } from "./copy/picker.ts";
export { OUTLINE } from "./copy/outline.ts";
export type { ToolKey } from "./copy/help.ts";
export { HELP } from "./copy/help.ts";
export { PLACEMENT } from "./copy/placement.ts";
export type { Representation } from "./copy/resources-panel.ts";
export { RESOURCES_PANEL, RESOURCE_ROW } from "./copy/resources-panel.ts";
export { RESOURCE_DETAILS } from "./copy/resource-details.ts";
export type { ResourceKind } from "./copy/resource-editor.ts";
export { RESOURCE_EDITOR, RESOURCE_CONTROLS } from "./copy/resource-editor.ts";
export { DISCOVERY, SUGGESTIONS, LEGACY_REVIEW } from "./copy/discovery.ts";
export type { RecoverableActionKind } from "./copy/recovery.ts";
export { RESOURCE_RECOVERY, SCENE_RECOVERY, MUTATION_RECOVERY, TRANSACTION } from "./copy/recovery.ts";
export { SAVE_ANNOUNCEMENTS, REASON_ANNOUNCEMENTS, RECOVERY_ANNOUNCEMENTS, CANVAS_ANNOUNCEMENTS, FIND_ANNOUNCEMENTS, PICKER_ANNOUNCEMENTS, RESOURCE_ANNOUNCEMENTS } from "./copy/announcements.ts";
export type { FailureCopy } from "./copy/errors.ts";
export { EDITOR_BOUNDARY, INTERNAL_ERRORS, copyForFailure, knownFailureKinds } from "./copy/errors.ts";
export { DEBUG } from "./copy/debug.ts";

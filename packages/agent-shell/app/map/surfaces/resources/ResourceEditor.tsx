// The Add, Edit and Suggestion form, shown over the inventory as the registered `resourceEditor`
// surface. Escape is a back-step: the draft is kept and the inventory shows the unsaved-draft
// strip, so a person never loses what they typed. Save inspects the target first, and a missing
// path is recorded only after the person confirms it here.

import type { ReactNode } from "react";
import { RESOURCE_EDITOR } from "../../copy.ts";
import type { ResourceKind } from "../../copy.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { Select } from "../../ui/Select.tsx";
import { Surface } from "../../ui/Surface.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { RESOURCE_DRAFT_EDITS, discardResourceDraft, holdResourceDraft } from "./resource-actions.ts";
import { resourceEntityForRow, rowTargetText } from "./resource-rows.ts";
import { saveResourceDraft } from "./resources-mutations.ts";
import type { ResourceDraft, ResourcesState } from "./resources-state.ts";
import { panelControlFlags } from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type ResourceEditorProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** The heading id the surface is labelled by. */
const TITLE_ID = "tangent-map-resource-editor-title";

/** The kinds the form offers, each with the words it is chosen by. */
const KIND_OPTIONS = [
  { value: "worktree", label: RESOURCE_EDITOR.kinds.worktree },
  { value: "repository", label: RESOURCE_EDITOR.kinds.repository },
  { value: "link", label: RESOURCE_EDITOR.kinds.link },
] as const;

/** The heading of the form: what the draft is for. */
function draftTitle(draft: ResourceDraft): string {
  if (draft.mode === "edit") return RESOURCE_EDITOR.editTitle;
  return draft.mode === "suggestion" ? RESOURCE_EDITOR.suggestionTitle : RESOURCE_EDITOR.addTitle(draft.kind);
}

/** The target the edited resource points at now, empty unless an edit changed it. */
function previousTarget(draft: ResourceDraft): string {
  if (draft.mode !== "edit") return "";
  const current = rowTargetText(resourceEntityForRow(draft.row));
  return current === draft.target ? "" : current;
}

/** The exact target the server normalised the typed one to, empty until it was inspected. */
function validatedTarget(draft: ResourceDraft): string {
  const normalized = draft.inspection?.normalized;
  return normalized?.path ?? normalized?.url ?? "";
}

/** The before and after of a changed target, so an edit shows what it replaces. */
function TargetChange(props: { readonly previous: string; readonly next: string }): ReactNode {
  return (
    <dl className="tangent-map-resource-target-change">
      <div>
        <dt>{RESOURCE_EDITOR.currentTarget}</dt>
        <dd><code>{props.previous}</code></dd>
      </div>
      <div>
        <dt>{RESOURCE_EDITOR.newTarget}</dt>
        <dd><code>{props.next}</code></dd>
      </div>
    </dl>
  );
}

/** Renders the draft form, or nothing when there is no draft or the person stepped back from it. */
export function ResourceEditor(props: ResourceEditorProps): ReactNode {
  const { state, ports } = props;
  const draft = state.editor;
  if (!draft || draft.hidden) return null;
  const effects = ports.effects;
  const previous = previousTarget(draft);
  const validated = validatedTarget(draft);

  /** Saves the draft: the target is inspected, then the fenced mutation is sent. */
  function save(): void {
    void saveResourceDraft(effects);
  }

  /** Steps back to the inventory and keeps the draft. */
  function back(): void {
    holdResourceDraft(effects, true);
  }

  return (
    <Surface id="resourceEditor" className="tangent-map-resource-editor" labelledBy={TITLE_ID} initialFocus="input" onClose={back} onBackStep={back}>
      <Button className="tangent-map-resource-back" onActivate={back}>{RESOURCE_EDITOR.back}</Button>
      <h3 id={TITLE_ID}>{draftTitle(draft)}</h3>
      <Select
        label={RESOURCE_EDITOR.kind}
        value={draft.kind}
        options={KIND_OPTIONS}
        onChange={(value) => { RESOURCE_DRAFT_EDITS.kind(effects, value as ResourceKind); }}
      />
      <TextField
        label={RESOURCE_EDITOR.targetLabel(draft.kind)}
        value={draft.target}
        required
        keys={{ /** Saves the draft from the target field, the way a form submits. */ Enter: save }}
        onChange={(value) => { RESOURCE_DRAFT_EDITS.target(effects, value); }}
      />
      <TextField
        label={RESOURCE_EDITOR.label}
        value={draft.label}
        keys={{ /** Saves the draft from the label field too. */ Enter: save }}
        onChange={(value) => { RESOURCE_DRAFT_EDITS.label(effects, value); }}
      />
      {previous && <TargetChange previous={previous} next={draft.target} />}
      {validated && <p>{RESOURCE_EDITOR.validated}<code>{validated}</code></p>}
      {draft.inspection?.state === "missing" && (
        <Checkbox
          className="tangent-map-resource-confirm"
          label={RESOURCE_EDITOR.confirmMissing}
          checked={draft.confirmMissing}
          onChange={(confirmed) => { RESOURCE_DRAFT_EDITS.confirmMissing(effects, confirmed); }}
        />
      )}
      {draft.error && <p className="tangent-map-resource-form-error" role="alert">{draft.error}</p>}
      <div className="tangent-map-resource-actions">
        <Button disabled={!panelControlFlags(state, effects).writable} onActivate={save}>
          {state.busy ? RESOURCE_EDITOR.saving : RESOURCE_EDITOR.save}
        </Button>
        <Button onActivate={() => { discardResourceDraft(effects); }}>{RESOURCE_EDITOR.discardChanges}</Button>
      </div>
    </Surface>
  );
}

// The strip a refused catalog mutation leaves inside the panel: what happened, what to do next,
// and one button per way out. The words never name the failure code (audit defect 11) and every
// button does something (defect 10), because `copyForFailure` owns the sentences and each action
// is a named command. The retained draft and the server's evidence stay until one of them is used.

import type { ReactNode } from "react";
import { MUTATION_RECOVERY, SCENE_RECOVERY, copyForFailure } from "../../copy.ts";
import { Button } from "../../ui/Button.tsx";
import { areaKey } from "../../units/ids.ts";
import { closeMutationRecovery, holdResourceDraft, reloadResourcesForDraft, viewResourceArea } from "./resource-actions.ts";
import { chooseLegacyBranch, openRecoveryResource, recoveryOwner, retryResourceMutationRecovery } from "./resources-mutations.ts";
import type { ResourceMutationRecovery, ResourcesState } from "./resources-state.ts";
import { rowForLocator } from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type MutationRecoveryProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** The codes a reload rebases the retained draft for. */
const RELOAD_CODES: ReadonlySet<string> = new Set(["catalog-revision-changed", "suggestion-changed"]);

/** The sentence under the failure: the owner to open for a read-only resource, else the next step. */
function nextStepText(recovery: ResourceMutationRecovery): string {
  if (recovery.code === "inherited-resource-read-only" || recovery.code === "area-resource-read-only") {
    return MUTATION_RECOVERY.belongsTo(recoveryOwner(recovery));
  }
  return copyForFailure(recovery.code).nextStep;
}

/** The buttons a refused duplicate offers: the resource that already holds the target, on the panel or the Map. */
function DuplicateActions(props: MutationRecoveryProps): ReactNode {
  const { state, ports } = props;
  const existing = state.mutationRecovery?.recovery.existing;
  const row = rowForLocator(state.projection, existing);

  /** Closes the strip and hands the duplicate row to the placement surface. */
  function showExisting(): void {
    if (!row) return;
    closeMutationRecovery(ports.effects);
    ports.placeOnMap(row);
  }

  return (
    <>
      <Button onActivate={() => { openRecoveryResource(ports.effects); }}>{MUTATION_RECOVERY.openResource}</Button>
      {row && <Button onActivate={showExisting}>{MUTATION_RECOVERY.showOnMap}</Button>}
    </>
  );
}

/** The one button per imported target that could own a legacy Branch, so the person picks one. */
function BranchChoiceActions(props: MutationRecoveryProps): ReactNode {
  const { state, ports } = props;
  const choices = state.mutationRecovery?.recovery.choices ?? [];
  return (
    <>
      {choices.map((choice) => (
        <Button
          key={`${choice.owner}:${choice.targetFingerprint ?? ""}`}
          onActivate={() => { chooseLegacyBranch(ports.effects, choice); }}
        >
          {MUTATION_RECOVERY.useChoice(choice.field, choice.label)}
        </Button>
      ))}
    </>
  );
}

/** The way out one failure code offers, or nothing when only closing the strip makes sense. */
function RecoveryActions(props: MutationRecoveryProps): ReactNode {
  const { state, ports } = props;
  const recovery = state.mutationRecovery;
  if (!recovery) return null;
  const owner = recoveryOwner(recovery);
  if (recovery.code === "duplicate-resource-target") return <DuplicateActions state={state} ports={ports} />;
  if (recovery.code === "legacy-branch-choice-required") return <BranchChoiceActions state={state} ports={ports} />;
  if (RELOAD_CODES.has(recovery.code)) {
    return <Button onActivate={() => { reloadResourcesForDraft(ports.effects); }}>{MUTATION_RECOVERY.reloadResources}</Button>;
  }
  if (recovery.code === "missing-target-confirmation-required") {
    return <Button onActivate={() => { holdResourceDraft(ports.effects, false); }}>{MUTATION_RECOVERY.reviewMissingPath}</Button>;
  }
  if (owner && (recovery.code === "inherited-resource-read-only" || recovery.code === "area-resource-read-only")) {
    return <Button onActivate={() => { viewResourceArea(ports.effects, areaKey(owner)); }}>{MUTATION_RECOVERY.openAreaResources(ports.areaName(owner))}</Button>;
  }
  if (recovery.request && recovery.mutation) {
    return <Button onActivate={() => { void retryResourceMutationRecovery(ports.effects); }}>{SCENE_RECOVERY.retrySameOperation}</Button>;
  }
  return null;
}

/** Renders the recovery strip of a refused catalog mutation, or nothing when none is retained. */
export function MutationRecovery(props: MutationRecoveryProps): ReactNode {
  const { state, ports } = props;
  const recovery = state.mutationRecovery;
  if (!recovery) return null;
  return (
    <div className="tangent-map-resource-problem" role="alert">
      <strong>{recovery.message}</strong>
      <span>{nextStepText(recovery)}</span>
      <div className="tangent-map-resource-actions">
        <RecoveryActions state={state} ports={ports} />
        <Button onActivate={() => { closeMutationRecovery(ports.effects); }}>{MUTATION_RECOVERY.closeError}</Button>
      </div>
    </div>
  );
}

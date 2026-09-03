// The two review lists under the inventory: the Suggestions an Area's notes propose, and the
// legacy declarations still waiting to be imported. Each row is one bounded block: the name and
// the exact target on one line, the provenance clamped under it, the actions below. A Suggestion
// owned by an ancestor offers the route to that Area instead of a write its server would refuse.

import type { ReactNode } from "react";
import { LEGACY_REVIEW, SUGGESTIONS } from "../../copy.ts";
import type { ResourceSuggestion } from "../../kernel/kernel-types.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { areaKey } from "../../units/ids.ts";
import { viewResourceArea } from "./resource-actions.ts";
import { toggleLegacyCandidate } from "./resource-actions.ts";
import { legacyCandidateKey, suggestionIsDirect, suggestionLabel, suggestionTargetText } from "./resource-rows.ts";
import { dismissSuggestion, editResource, importSelectedLegacy } from "./resources-mutations.ts";
import type { ResourcesState } from "./resources-state.ts";
import { panelControlFlags } from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type ReviewListProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** One review row: the name and target on one line, the owner and provenance under it, the actions last. */
function ReviewRow(props: { readonly label: string; readonly target: string; readonly owner?: string | undefined; readonly provenance?: string | undefined; readonly children: ReactNode }): ReactNode {
  return (
    <li>
      <div className="tangent-map-resource-review-summary">
        <strong>{props.label}</strong>
        <code title={props.target}>{props.target}</code>
      </div>
      {props.owner && <span className="tangent-map-resource-review-owner">{SUGGESTIONS.from(props.owner)}</span>}
      {props.provenance && <p className="tangent-map-resource-review-provenance" title={props.provenance}>{props.provenance}</p>}
      <div className="tangent-map-resource-actions">{props.children}</div>
    </li>
  );
}

/** The buttons of one Suggestion: its two writes when it is this Area's, else the route to its owner. */
function SuggestionActions(props: { readonly suggestion: ResourceSuggestion; readonly state: ResourcesState; readonly ports: ResourcePanelPorts }): ReactNode {
  const { suggestion, state, ports } = props;
  const name = suggestionLabel(suggestion);
  const owner = suggestion.owner;
  if (!suggestionIsDirect(suggestion, state.area)) {
    return (
      <Button aria-label={SUGGESTIONS.reviewName(name, owner)} onActivate={() => { viewResourceArea(ports.effects, areaKey(owner)); }}>
        {SUGGESTIONS.reviewIn(ports.areaName(owner))}
      </Button>
    );
  }
  const writable = panelControlFlags(state, ports.effects).writable;
  return (
    <>
      <Button aria-label={SUGGESTIONS.addName(name)} disabled={!writable} onActivate={() => { editResource(ports.effects, { mode: "suggestion", suggestion }); }}>
        {SUGGESTIONS.addToArea}
      </Button>
      <Button aria-label={SUGGESTIONS.dismissName(name)} disabled={!writable} onActivate={() => { void dismissSuggestion(ports.effects, suggestion); }}>
        {SUGGESTIONS.dismiss}
      </Button>
    </>
  );
}

/** Renders the Suggestions list, or nothing when the Area has none. */
export function Suggestions(props: ReviewListProps): ReactNode {
  const { state, ports } = props;
  const suggestions = state.projection?.suggestions ?? [];
  if (suggestions.length === 0) return null;
  return (
    <section className="tangent-map-resource-review">
      <h3>{SUGGESTIONS.title}</h3>
      <ul>
        {suggestions.map((suggestion) => (
          <ReviewRow
            key={`${suggestion.owner}:${suggestion.evidenceHash ?? ""}:${suggestion.targetFingerprint ?? ""}`}
            label={suggestionLabel(suggestion)}
            target={suggestionTargetText(suggestion)}
            owner={suggestionIsDirect(suggestion, state.area) ? undefined : suggestion.owner}
            provenance={suggestion.provenanceLabel}
          >
            <SuggestionActions suggestion={suggestion} state={state} ports={ports} />
          </ReviewRow>
        ))}
      </ul>
    </section>
  );
}

/** Renders the legacy declarations still to review, each selectable, imported together. */
export function LegacyReview(props: ReviewListProps): ReactNode {
  const { state, ports } = props;
  const candidates = state.projection?.legacyReview ?? [];
  if (candidates.length === 0 || state.legacyReviewHidden) return null;
  const writable = panelControlFlags(state, ports.effects).writable;
  return (
    <section className="tangent-map-resource-review">
      <h3>{LEGACY_REVIEW.title}</h3>
      <ul>
        {candidates.map((candidate) => {
          const key = legacyCandidateKey(candidate);
          return (
            <ReviewRow key={key} label={candidate.field || suggestionLabel(candidate)} target={suggestionTargetText(candidate) || candidate.message || ""}>
              {candidate.state === "candidate" && (
                <Checkbox
                  label={LEGACY_REVIEW.select}
                  checked={state.legacySelected.has(key)}
                  disabled={!writable}
                  onChange={(selected) => { toggleLegacyCandidate(ports.effects, key, selected); }}
                />
              )}
            </ReviewRow>
          );
        })}
      </ul>
      <div className="tangent-map-resource-actions">
        <Button disabled={!writable || state.legacySelected.size === 0} onActivate={() => { void importSelectedLegacy(ports.effects); }}>
          {LEGACY_REVIEW.import}
        </Button>
      </div>
    </section>
  );
}

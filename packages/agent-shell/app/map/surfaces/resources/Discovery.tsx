// The worktree discovery results: every place discovery looked, what it found there, and the
// problems it could not get past. Discovery never adds and never places anything, so this view has
// no write; the one action it offers is copying a repository path it found. It is a named region
// inside the panel rather than a surface of its own, because it opens nothing over the Map.

import type { ReactNode } from "react";
import { DISCOVERY, copyForFailure } from "../../copy.ts";
import type { ResourcePanelRow } from "../../kernel/kernel-types.ts";
import { Button } from "../../ui/Button.tsx";
import { index } from "../../units/units.ts";
import type { Index } from "../../units/units.ts";
import { runResourceAction } from "./resource-actions.ts";
import { resourceRowLabel } from "./resource-rows.ts";
import { discoverResources } from "./resources-effects.ts";
import type { DiscoveryProblem, DiscoverySource } from "./resources-wire.ts";
import type { ResourcesState } from "./resources-state.ts";
import { rowFactsFor, rowForLocator } from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type DiscoveryProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** The words for how completely one source could be inspected. */
function sourceStateText(source: DiscoverySource): string {
  if (source.state === "complete") return DISCOVERY.checked;
  return source.state === "partial" ? DISCOVERY.checkedWithProblems : DISCOVERY.couldNotInspect;
}

/** The name one source reads by: the resource it found, the Goal it came from, its file, or its position. */
function sourceLabel(source: DiscoverySource, row: ResourcePanelRow | null, position: Index): string {
  const label = resourceRowLabel(row);
  if (label) return label;
  if (source.source?.jobSlug) return DISCOVERY.goalSource(source.source.jobSlug);
  return source.source?.file ?? DISCOVERY.numberedSource(position);
}

/** The key one source renders under: its resource, its Goal, or its position. */
function sourceKey(source: DiscoverySource, position: Index): string {
  const locator = source.source?.resource;
  return `${source.source?.kind ?? ""}:${locator?.owner ?? ""}:${locator?.id ?? source.source?.jobSlug ?? position}`;
}

/** One place discovery looked, with the copy action when it found a repository path. */
function DiscoverySourceRow(props: { readonly source: DiscoverySource; readonly position: Index; readonly state: ResourcesState; readonly ports: ResourcePanelPorts }): ReactNode {
  const { source, position, state, ports } = props;
  const row = rowForLocator(state.projection, source.source?.resource);
  const facts = row ? rowFactsFor(state, ports, row).facts : null;
  const copyPath = facts?.primaryAction?.kind === "copy-path" ? facts.primaryAction : null;
  return (
    <li>
      <strong>{sourceLabel(source, row, position)}</strong>
      <span>{sourceStateText(source)}</span>
      {(source.diagnostics ?? []).map((problem) => <span key={`${problem.code}:${problem.path ?? ""}`}>{problem.message}</span>)}
      {facts && copyPath && (
        <Button onActivate={() => { void runResourceAction(ports.effects, facts, copyPath); }}>{DISCOVERY.copyRepositoryPath}</Button>
      )}
    </li>
  );
}

/** One problem discovery could not get past, in words, with a retry when it may pass next time. */
function DiscoveryProblemRow(props: { readonly problem: DiscoveryProblem; readonly ports: ResourcePanelPorts }): ReactNode {
  const { problem, ports } = props;
  return (
    <li>
      <strong>{copyForFailure(problem.code).headline}</strong>
      <span>{problem.message}</span>
      {problem.retryable && <Button onActivate={() => { void discoverResources(ports.effects); }}>{DISCOVERY.retry}</Button>}
    </li>
  );
}

/** Renders the discovery results, or nothing when discovery has not run. */
export function Discovery(props: DiscoveryProps): ReactNode {
  const { state, ports } = props;
  const discovery = state.discovery;
  if (!discovery) return null;
  const sources = discovery.sources ?? [];
  return (
    <section className="tangent-map-resource-review" aria-label={DISCOVERY.name}>
      <h3>{DISCOVERY.title}</h3>
      {discovery.state === "checking" && <p role="status">{DISCOVERY.checking}</p>}
      {discovery.state !== "checking" && sources.length === 0 && <p>{DISCOVERY.noSources}</p>}
      {discovery.state !== "checking" && sources.length > 0 && (
        <ul>
          {sources.map((source, position) => (
            <DiscoverySourceRow key={sourceKey(source, index(position))} source={source} position={index(position)} state={state} ports={ports} />
          ))}
        </ul>
      )}
      {discovery.problems.length > 0 && (
        <ul>
          {discovery.problems.map((problem) => <DiscoveryProblemRow key={`${problem.code}:${problem.path ?? ""}`} problem={problem} ports={ports} />)}
        </ul>
      )}
    </section>
  );
}

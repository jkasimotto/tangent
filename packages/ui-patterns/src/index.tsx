import React, { type ReactNode } from "react";
import { Button, Disclosure, EmptyState } from "@tangent/ui-primitives";

/** Combines class names for Tangent UI elements. */
function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Renders the AppFrame UI. */
export function AppFrame({
  topBar,
  sidebar,
  inspector,
  children
}: {
  topBar: ReactNode;
  sidebar?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className={cx("tg-app-frame", Boolean(inspector) && "tg-app-frame--with-inspector")}>
      <div className="tg-app-frame__top">{topBar}</div>
      {sidebar ? <aside className="tg-app-frame__sidebar">{sidebar}</aside> : null}
      <main className="tg-app-frame__main">{children}</main>
      {inspector ? <aside className="tg-app-frame__inspector">{inspector}</aside> : null}
    </div>
  );
}

/** Renders the MasterDetailLayout UI. */
export function MasterDetailLayout({
  list,
  detail,
  inspector
}: {
  list: ReactNode;
  detail: ReactNode;
  inspector?: ReactNode;
}): React.ReactElement {
  return (
    <div className={cx("tg-master-detail", Boolean(inspector) && "tg-master-detail--with-inspector")}>
      <aside className="tg-master-detail__list">{list}</aside>
      <section className="tg-master-detail__detail">{detail}</section>
      {inspector ? <aside className="tg-master-detail__inspector">{inspector}</aside> : null}
    </div>
  );
}

export const ListDetailLayout = MasterDetailLayout;

/** Renders the CompareLayout UI. */
export function CompareLayout({
  controls,
  overview,
  left,
  right,
  tabs,
  inspector
}: {
  controls: ReactNode;
  overview?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  tabs?: ReactNode;
  inspector?: ReactNode;
}): React.ReactElement {
  return (
    <div className={cx("tg-compare-layout", Boolean(inspector) && "tg-compare-layout--with-inspector")}>
      <div className="tg-compare-layout__controls">{controls}</div>
      {overview ? <section className="tg-compare-layout__overview">{overview}</section> : null}
      <section className="tg-compare-layout__panes">
        <div>{left}</div>
        <div>{right}</div>
      </section>
      {tabs ? <section className="tg-compare-layout__tabs">{tabs}</section> : null}
      {inspector ? <aside className="tg-compare-layout__inspector">{inspector}</aside> : null}
    </div>
  );
}

/** Renders the AnalysisWorkbench UI. */
export function AnalysisWorkbench({
  header,
  metrics,
  visualization,
  table,
  inspector
}: {
  header?: ReactNode;
  metrics: ReactNode;
  visualization: ReactNode;
  table?: ReactNode;
  inspector?: ReactNode;
}): React.ReactElement {
  return (
    <div className={cx("tg-analysis-workbench", Boolean(inspector) && "tg-analysis-workbench--with-inspector")}>
      {header ? <header className="tg-analysis-workbench__header">{header}</header> : null}
      <section className="tg-analysis-workbench__metrics">{metrics}</section>
      <section className="tg-analysis-workbench__visualization">{visualization}</section>
      {table ? <section className="tg-analysis-workbench__table">{table}</section> : null}
      {inspector ? <aside className="tg-analysis-workbench__inspector">{inspector}</aside> : null}
    </div>
  );
}

/** Renders the TranscriptLayout UI. */
export function TranscriptLayout({
  rail,
  messages,
  evidence
}: {
  rail?: ReactNode;
  messages: ReactNode;
  evidence?: ReactNode;
}): React.ReactElement {
  return (
    <div className={cx("tg-transcript-layout", Boolean(evidence) && "tg-transcript-layout--with-evidence")}>
      {rail ? <aside className="tg-transcript-layout__rail">{rail}</aside> : null}
      <section className="tg-transcript-layout__messages">{messages}</section>
      {evidence ? <aside className="tg-transcript-layout__evidence">{evidence}</aside> : null}
    </div>
  );
}

export const TimelineLayout = TranscriptLayout;

/** Renders the RollupBuilderLayout UI. */
export function RollupBuilderLayout({
  steps,
  preview,
  output,
  actions
}: {
  steps: ReactNode;
  preview: ReactNode;
  output?: ReactNode;
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <div className="tg-rollup-builder">
      <section className="tg-rollup-builder__steps">{steps}</section>
      <section className="tg-rollup-builder__preview">{preview}</section>
      {output ? <section className="tg-rollup-builder__output">{output}</section> : null}
      {actions ? <footer className="tg-rollup-builder__actions">{actions}</footer> : null}
    </div>
  );
}

export const SetupRunLayout = RollupBuilderLayout;

/** Renders the QueryBuilder UI. */
export function QueryBuilder({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="tg-query-builder">{children}</div>;
}

/** Renders the FilterPresetPicker UI. */
export function FilterPresetPicker({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="tg-filter-preset-picker">{children}</div>;
}

/** Renders the InspectableObject UI. */
export function InspectableObject({ label, children }: { label: string; children: ReactNode }): React.ReactElement {
  return <Disclosure title={label}>{children}</Disclosure>;
}

/** Renders the EvidenceDrawer UI. */
export function EvidenceDrawer({ children }: { children: ReactNode }): React.ReactElement {
  return <aside className="tg-evidence-drawer">{children}</aside>;
}

/** Renders the CaveatDisclosure UI. */
export function CaveatDisclosure({ caveats }: { caveats: string[] }): React.ReactElement | null {
  if (!caveats.length) return null;
  return <Disclosure title={`Caveats (${caveats.length})`}><ul>{caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></Disclosure>;
}

/** Renders the ProgressiveMetadata UI. */
export function ProgressiveMetadata({ label = "Raw metadata", children }: { label?: string; children: ReactNode }): React.ReactElement {
  return <Disclosure title={label}>{children}</Disclosure>;
}

/** Renders the EmptyFirstRun UI. */
export function EmptyFirstRun({ onCreate }: { onCreate?: () => void }): React.ReactElement {
  return <EmptyState title="No runs yet">{onCreate ? <Button variant="primary" onClick={onCreate}>Create run</Button> : null}</EmptyState>;
}

/** Renders the ErrorRecoveryPanel UI. */
export function ErrorRecoveryPanel({ message, action }: { message: string; action?: ReactNode }): React.ReactElement {
  return <section className="tg-error-recovery" role="alert"><p>{message}</p>{action}</section>;
}

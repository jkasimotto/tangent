import React, { type ReactNode } from "react";
import { Badge, Button, type ActionModel, type Tone } from "@tangent/ui-primitives";

export type { ActionModel, Tone } from "@tangent/ui-primitives";

export type Confidence = "exact" | "derived" | "partial" | "estimated" | "unknown";
export type MetricUnit = "ms" | "tokens" | "usd" | "count" | "files" | "percent";

export type MetricValue = {
  label: string;
  value?: number | string;
  unit?: MetricUnit;
  confidence?: Confidence;
};

export type MetricDeltaValue = {
  label: string;
  left?: number;
  right?: number;
  delta?: number;
  unit?: MetricValue["unit"];
  polarity?: "lower-is-better" | "higher-is-better" | "neutral";
};

export type ResourceListItemModel = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string[];
  status?: string;
  badges?: Array<{ label: string; tone?: Tone }>;
  primaryAction?: ActionModel;
  secondaryActions?: ActionModel[];
};

/** Combines class names for Tangent UI elements. */
function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Formats metric. */
export function formatMetric(value: number | string | undefined, unit?: MetricUnit): string {
  if (value === undefined || value === "") return "Unknown";
  if (typeof value === "string") return value;
  if (unit === "ms") return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
  if (unit === "tokens") return Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
  if (unit === "usd") return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  if (unit === "percent") return `${Math.round(value * 100)}%`;
  return Intl.NumberFormat("en").format(value);
}

export type MetricCardProps = {
  label: string;
  value?: string | number;
  unit?: Exclude<MetricUnit, "percent">;
  confidence?: Confidence;
  trend?: MetricDeltaValue;
  description?: string;
  caveatCount?: number;
  onInspect?: () => void;
};

/** Renders the MetricCard UI. */
export function MetricCard({ label, value, unit, confidence, trend, description, caveatCount, onInspect }: MetricCardProps): React.ReactElement {
  return (
    <section className="tg-metric-card">
      <div className="tg-metric-card__header">
        <span>{label}</span>
        {confidence ? <ConfidenceBadge confidence={confidence} /> : null}
      </div>
      <div className="tg-metric-card__value">{formatMetric(value, unit)}</div>
      {trend ? <MetricDelta {...trend} leftLabel="Left" rightLabel="Right" polarity={trend.polarity || "neutral"} /> : null}
      {description ? <p className="tg-metric-card__description">{description}</p> : null}
      <div className="tg-metric-card__footer">
        {caveatCount ? <Badge tone="warning">{caveatCount} caveats</Badge> : null}
        {onInspect ? <Button variant="ghost" onClick={onInspect}>Inspect</Button> : null}
      </div>
    </section>
  );
}

export type MetricDeltaProps = {
  label: string;
  leftLabel: string;
  rightLabel: string;
  left?: number;
  right?: number;
  delta?: number;
  unit?: MetricUnit;
  polarity: "lower-is-better" | "higher-is-better" | "neutral";
  confidence?: Confidence;
};

/** Renders the MetricDelta UI. */
export function MetricDelta({ label, leftLabel, rightLabel, left, right, delta, unit, polarity, confidence }: MetricDeltaProps): React.ReactElement {
  const actualDelta = delta ?? (left !== undefined && right !== undefined ? right - left : undefined);
  const direction = actualDelta === undefined || actualDelta === 0 ? "neutral" : actualDelta > 0 ? "up" : "down";
  const favorable = polarity === "neutral" || actualDelta === undefined || actualDelta === 0
    ? "neutral"
    : polarity === "lower-is-better"
      ? actualDelta < 0 ? "good" : "bad"
      : actualDelta > 0 ? "good" : "bad";
  return (
    <div className={cx("tg-metric-delta", `tg-metric-delta--${favorable}`)}>
      <div className="tg-metric-delta__label">{label}</div>
      <div className="tg-metric-delta__values">
        <span>{leftLabel}: {formatMetric(left, unit)}</span>
        <span>{rightLabel}: {formatMetric(right, unit)}</span>
      </div>
      <div className="tg-metric-delta__delta" data-direction={direction}>
        {actualDelta === undefined ? "Unknown delta" : `${actualDelta > 0 ? "+" : ""}${formatMetric(actualDelta, unit)}`}
      </div>
      {confidence ? <ConfidenceBadge confidence={confidence} /> : null}
    </div>
  );
}

/** Renders the ResourceList UI. */
export function ResourceList({ items, onSelect }: { items: ResourceListItemModel[]; onSelect?: (id: string) => void }): React.ReactElement {
  return (
    <div className="tg-resource-list" role="list">
      {items.map((item) => (
        <ResourceListItem key={item.id} item={item} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** Renders the ResourceListItem UI. */
export function ResourceListItem({ item, onSelect }: { item: ResourceListItemModel; onSelect?: (id: string) => void }): React.ReactElement {
  return (
    <div className="tg-resource-list-item" role="listitem">
      <button className="tg-resource-list-item__main" type="button" onClick={() => onSelect?.(item.id)}>
        <span className="tg-resource-list-item__title">{item.title}</span>
        {item.subtitle ? <span className="tg-resource-list-item__subtitle">{item.subtitle}</span> : null}
        {item.meta?.length ? <span className="tg-resource-list-item__meta">{item.meta.join(" · ")}</span> : null}
      </button>
      <div className="tg-resource-list-item__badges">
        {item.status ? <StatusPill status={item.status} /> : null}
        {item.badges?.map((badge) => <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>)}
      </div>
    </div>
  );
}

/** Renders the StatusPill UI. */
export function StatusPill({ status }: { status: string }): React.ReactElement {
  const normalized = status.toLowerCase();
  const tone: Tone = normalized.includes("fail") || normalized.includes("error") ? "danger" : normalized.includes("done") || normalized.includes("pass") ? "success" : normalized.includes("warn") ? "warning" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}

/** Renders the ConfidenceBadge UI. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }): React.ReactElement {
  const tone: Tone = confidence === "exact" || confidence === "derived" ? "success" : confidence === "unknown" ? "warning" : "info";
  return <Badge tone={tone}>{confidence}</Badge>;
}

/** Renders the CapabilityBadge UI. */
export function CapabilityBadge({ label, supported }: { label: string; supported: boolean }): React.ReactElement {
  return <Badge tone={supported ? "success" : "warning"}>{label}</Badge>;
}

/** Renders the CaveatList UI. */
export function CaveatList({ caveats }: { caveats: string[] }): React.ReactElement | null {
  if (!caveats.length) return null;
  return (
    <section className="tg-caveat-list" aria-label="Caveats">
      <strong>Caveats</strong>
      <ul>
        {caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
      </ul>
    </section>
  );
}

/** Renders the EvidenceLink UI. */
export function EvidenceLink({ label, onOpen }: { label: string; onOpen?: () => void }): React.ReactElement {
  return <Button variant="ghost" onClick={onOpen}>{label}</Button>;
}

/** Renders the TimelineLegend UI. */
export function TimelineLegend({ items }: { items: Array<{ label: string; tone?: Tone }> }): React.ReactElement {
  return <div className="tg-legend">{items.map((item) => <Badge key={item.label} tone={item.tone}>{item.label}</Badge>)}</div>;
}

/** Renders the SelectionSummary UI. */
export function SelectionSummary({ children }: { children: ReactNode }): React.ReactElement {
  return <aside className="tg-selection-summary">{children}</aside>;
}

/** Renders the CompareSelector UI. */
export function CompareSelector({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="tg-compare-selector">{children}</div>;
}

/** Renders the RunStatusStrip UI. */
export function RunStatusStrip({ statuses }: { statuses: Record<string, number> }): React.ReactElement {
  return <div className="tg-status-strip">{Object.entries(statuses).map(([status, count]) => <StatusPill key={status} status={`${status} ${count}`} />)}</div>;
}

/** Renders the JobProgressList UI. */
export function JobProgressList({ jobs }: { jobs: Array<{ id: string; label: string; status: string }> }): React.ReactElement {
  return <div className="tg-job-progress-list">{jobs.map((job) => <StatusPill key={job.id} status={`${job.label}: ${job.status}`} />)}</div>;
}

/** Renders the FileList UI. */
export function FileList({ files }: { files: string[] }): React.ReactElement {
  return <ul className="tg-file-list">{files.map((file) => <li key={file}>{file}</li>)}</ul>;
}

/** Renders the ArtifactLink UI. */
export function ArtifactLink({ path, label = path }: { path: string; label?: string }): React.ReactElement {
  return <span className="tg-artifact-link" title={path}>{label}</span>;
}

/** Renders the AppHeader UI. */
export const AppHeader = ({ children }: { children: ReactNode }) => <header className="tg-app-header">{children}</header>;
/** Renders the AppSidebar UI. */
export const AppSidebar = ({ children }: { children: ReactNode }) => <nav className="tg-app-sidebar">{children}</nav>;
/** Renders the PageHeader UI. */
export const PageHeader = ({ title, actions }: { title: ReactNode; actions?: ReactNode }) => <header className="tg-page-header"><h1>{title}</h1>{actions}</header>;
/** Renders the PageToolbar UI. */
export const PageToolbar = ({ children }: { children: ReactNode }) => <div className="tg-page-toolbar">{children}</div>;
/** Renders the Breadcrumbs UI. */
export const Breadcrumbs = ({ items }: { items: string[] }) => <nav className="tg-breadcrumbs" aria-label="Breadcrumbs">{items.join(" / ")}</nav>;
/** Renders the DetailPanel UI. */
export const DetailPanel = ({ children }: { children: ReactNode }) => <aside className="tg-detail-panel">{children}</aside>;
/** Renders the SplitPane UI. */
export const SplitPane = ({ left, right }: { left: ReactNode; right: ReactNode }) => <div className="tg-split-pane"><div>{left}</div><div>{right}</div></div>;
export const InspectorPanel = DetailPanel;
/** Renders the CommandBar UI. */
export const CommandBar = ({ children }: { children: ReactNode }) => <div className="tg-command-bar">{children}</div>;
/** Renders the FilterBar UI. */
export const FilterBar = ({ children }: { children: ReactNode }) => <div className="tg-filter-bar">{children}</div>;
/** Renders the SavedViewBar UI. */
export const SavedViewBar = ({ children }: { children: ReactNode }) => <div className="tg-saved-view-bar">{children}</div>;
/** Renders the MetricTable UI. */
export const MetricTable = ({ children }: { children: ReactNode }) => <div className="tg-metric-table">{children}</div>;

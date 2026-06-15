import React from "react";
import { Button, Table } from "@tangent/ui-primitives";

export type TimelineBarChartItem = {
  id: string;
  label: string;
  kind: string;
  startedAt?: string;
  endedAt?: string;
  offsetMs?: number;
  durationMs?: number;
  metricValue?: number;
  depth?: number;
  status?: string;
  confidence?: "exact" | "derived" | "partial" | "estimated" | "unknown" | string;
};

export type TimelineBarChartProps = {
  items: TimelineBarChartItem[];
  metric: "durationMs" | "selfDurationMs" | "tokens.total" | "cost.amount";
  onSelect?: (id: string) => void;
  selectedId?: string;
  tableFallback?: boolean;
};

/** Supports the rows to csv helper. */
export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  /** Supports the quote helper. */
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  return [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n");
}

/** Copies chart data. */
export async function copyChartData(rows: Array<Record<string, unknown>>, format: "csv" | "json" = "csv"): Promise<string> {
  const text = format === "json" ? JSON.stringify(rows, null, 2) : rowsToCsv(rows);
  await globalThis.navigator?.clipboard?.writeText(text).catch(() => undefined);
  return text;
}

/** Renders the TimelineBarChart UI. */
export function TimelineBarChart({ items, metric, onSelect, selectedId, tableFallback = true }: TimelineBarChartProps): React.ReactElement {
  const rows = items.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    value: valueFor(item, metric),
    status: item.status,
    confidence: item.confidence
  }));
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return (
    <section className="tg-chart" aria-label={`Timeline by ${metric}`}>
      <div className="tg-chart__actions">
        <Button variant="ghost" onClick={() => void copyChartData(rows, "csv")}>Copy CSV</Button>
        <Button variant="ghost" onClick={() => void copyChartData(rows, "json")}>Copy JSON</Button>
      </div>
      <div className="tg-timeline-bars" role="list" aria-label="Timeline chart">
        {items.map((item) => {
          const value = valueFor(item, metric);
          const width = `${Math.max(2, (value / max) * 100)}%`;
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className="tg-timeline-bar"
              data-selected={item.id === selectedId || undefined}
              style={{ marginLeft: `${(item.depth || 0) * 0.75}rem` }}
              onClick={() => onSelect?.(item.id)}
            >
              <span className="tg-timeline-bar__label">{item.label}</span>
              <span className="tg-timeline-bar__track"><span style={{ width }} /></span>
              <span className="tg-timeline-bar__value">{formatValue(value, metric)}</span>
            </button>
          );
        })}
      </div>
      {tableFallback ? <ChartDataTable rows={rows} /> : null}
    </section>
  );
}

/** Renders the ChartDataTable UI. */
export function ChartDataTable({ rows }: { rows: Array<Record<string, unknown>> }): React.ReactElement {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    <Table>
      <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody>
    </Table>
  );
}

/** Renders the MetricBarChart UI. */
export function MetricBarChart({ values }: { values: Array<{ label: string; value: number }> }): React.ReactElement {
  return <TimelineBarChart items={values.map((value) => ({ id: value.label, label: value.label, kind: "metric", metricValue: value.value }))} metric="durationMs" />;
}

export const MetricStackedBar = MetricBarChart;
export const MetricSeriesChart = MetricBarChart;
export const TokenBreakdownChart = MetricBarChart;
export const DurationBreakdownChart = MetricBarChart;
export const CompareMatrix = ChartDataTable;

/** Renders the Sparkline UI. */
export function Sparkline({ values }: { values: number[] }): React.ReactElement {
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${index * 10},${30 - (value / max) * 28}`).join(" ");
  return <svg className="tg-sparkline" viewBox={`0 0 ${Math.max(1, values.length - 1) * 10} 32`} aria-label="Sparkline"><polyline points={points} /></svg>;
}

/** Renders the ChartTooltip UI. */
export function ChartTooltip({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className="tg-chart-tooltip">{children}</span>;
}

export const WaterfallTimeline = TimelineBarChart;

/** Supports the value for helper. */
function valueFor(item: TimelineBarChartItem, metric: TimelineBarChartProps["metric"]): number {
  if (metric === "durationMs") return item.durationMs ?? item.metricValue ?? 0;
  return item.metricValue ?? item.durationMs ?? 0;
}

/** Formats value. */
function formatValue(value: number, metric: TimelineBarChartProps["metric"]): string {
  if (metric.includes("tokens")) return Intl.NumberFormat("en").format(value);
  if (metric.includes("cost")) return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

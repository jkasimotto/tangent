import React, { useEffect, useMemo, useState } from "react";
import { createUsageApiClient, type UsageSessionDetailView, type UsageSessionListItem, type UsageTimelineView, type UsageTranscriptView, type UsageUiClient } from "@tangent/usage-ui-data";
import { TangentAppShell, type TangentNavItem, type TangentNavModel } from "@tangent/ui-app-shell";
import { type Confidence, formatMetric } from "@tangent/ui-components";
import { EmptyState, Spinner } from "@tangent/ui-primitives";
import { TimelineBarChart } from "@tangent/ui-charts";
import { JsonInspector, TranscriptMessage } from "@tangent/ui-code";

export type UsageAppProps = {
  client?: UsageUiClient;
};

type UsageScreenState = {
  sessions: UsageSessionListItem[];
  selectedId?: string;
  detail?: UsageSessionDetailView;
  timeline?: UsageTimelineView;
  transcript?: UsageTranscriptView;
  caveats: string[];
  loading: boolean;
  error?: string;
};

type UsageView = "sessions" | "timeline" | "providers";

/** Renders the UsageApp UI. */
export function UsageApp({ client }: UsageAppProps = {}): React.ReactElement {
  const usageClient = useMemo(() => client || createUsageApiClient(), [client]);
  const [state, setState] = useState<UsageScreenState>({ sessions: [], caveats: [], loading: true });
  const [view, setView] = useState<UsageView>(() => initialUsageView());

  useEffect(() => {
    let cancelled = false;
    /** Loads the session list for the Usage UI. */
    const load = async () => {
      try {
        const list = await usageClient.listSessions({ limit: 50 });
        if (cancelled) return;
        setState((current) => ({
          ...current,
          sessions: list.sessions,
          caveats: list.caveats,
          selectedId: current.selectedId && list.sessions.some((session) => session.id === current.selectedId)
            ? current.selectedId
            : list.sessions[0]?.id,
          loading: false,
          error: undefined
        }));
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: (error as Error).message }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [usageClient]);

  useEffect(() => {
    if (!state.selectedId) return;
    let cancelled = false;
    setState((current) => ({ ...current, detail: undefined, timeline: undefined, transcript: undefined }));
    /** Loads the selected Usage session detail. */
    const loadSelected = async () => {
      try {
        const [detail, timeline, transcript] = await Promise.all([
          usageClient.getSession(state.selectedId!),
          usageClient.getSessionTimeline(state.selectedId!, { metric: "selfDurationMs" }),
          usageClient.getTranscript(state.selectedId!, { includeTools: true, previewChars: 1200 })
        ]);
        if (!cancelled) setState((current) => ({ ...current, detail, timeline, transcript, error: undefined }));
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, error: (error as Error).message }));
      }
    };
    void loadSelected();
    return () => {
      cancelled = true;
    };
  }, [state.selectedId, usageClient]);

  const nav: TangentNavModel = {
    product: "usage",
    sections: [{ label: "Usage", items: [
      { id: "sessions", label: "Sessions", href: "/usage/sessions" },
      { id: "timeline", label: "Timeline", href: "/usage/timeline" },
      { id: "providers", label: "Providers", href: "/usage/providers" }
    ] }]
  };

  useEffect(() => {
    const onPopState = () => setView(initialUsageView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (item: TangentNavItem) => {
    const nextView = usageViewForNavItem(item.id);
    setView(nextView);
    if (window.location.pathname !== item.href) window.history.pushState({}, "", item.href);
  };

  return (
    <TangentAppShell nav={nav} activeItemId={view} onNavigate={navigate}>
      <div className="usage-workbench">
        <SessionList
          sessions={state.sessions}
          selectedId={state.selectedId}
          loading={state.loading}
          onSelect={(selectedId) => setState((current) => ({ ...current, selectedId }))}
        />
        <SessionDetail state={state} view={view} />
      </div>
    </TangentAppShell>
  );
}

/** Renders the Usage session list. */
function SessionList({ sessions, selectedId, loading, onSelect }: { sessions: UsageSessionListItem[]; selectedId?: string; loading: boolean; onSelect(id: string): void }): React.ReactElement {
  return (
    <aside className="usage-sessions" aria-label="Usage sessions">
      <header className="usage-sessions__header">
        <div>
          <p className="usage-eyebrow">Sessions</p>
          <h2>Recent activity</h2>
        </div>
        <span>{loading ? "Loading" : `${sessions.length}`}</span>
      </header>
      {loading ? <Spinner /> : null}
      {!loading && !sessions.length ? (
        <EmptyState title="No sessions found">
          <p>Run `tangent usage status` to check native transcript discovery.</p>
        </EmptyState>
      ) : null}
      <div className="usage-sessions__list" role="list">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="listitem"
            className="usage-session-row"
            data-selected={session.id === selectedId || undefined}
            onClick={() => onSelect(session.id)}
          >
            <span className="usage-session-row__title">{cleanTitle(session.title)}</span>
            <span className="usage-session-row__meta">
              {compactMeta([
                session.provider,
                formatDate(session.startedAt),
                session.tokensTotal === undefined ? undefined : `${formatMetric(session.tokensTotal, "tokens")} tokens`,
                session.toolCalls === undefined ? undefined : `${session.toolCalls} tools`
              ])}
            </span>
            {session.caveatCount ? <span className="usage-session-row__caveats">{session.caveatCount}</span> : null}
          </button>
        ))}
      </div>
    </aside>
  );
}

/** Renders the selected Usage session detail. */
function SessionDetail({ state, view }: { state: UsageScreenState; view: UsageView }): React.ReactElement {
  if (state.error) return <main className="usage-detail"><EmptyState title="Usage data unavailable"><p>{friendlyError(state.error)}</p></EmptyState></main>;
  if (state.loading || (state.selectedId && !state.detail)) return <main className="usage-detail"><Spinner /></main>;
  if (!state.selectedId) return <main className="usage-detail"><EmptyState title="No session selected"><p>Select a session to inspect what happened.</p></EmptyState></main>;

  const detail = state.detail!;
  const caveats = [...new Set([...state.caveats, ...detail.caveats])];
  if (view === "timeline") return <TimelineDetail detail={detail} timeline={state.timeline} caveats={caveats} />;
  if (view === "providers") return <ProviderDetail detail={detail} caveats={caveats} />;
  return <SessionOverview detail={detail} timeline={state.timeline} transcript={state.transcript} caveats={caveats} />;
}

/** Renders the default Usage session overview. */
function SessionOverview({
  detail,
  timeline,
  transcript,
  caveats
}: {
  detail: UsageSessionDetailView;
  timeline?: UsageTimelineView;
  transcript?: UsageTranscriptView;
  caveats: string[];
}): React.ReactElement {
  const topTimeline = topTimelineItems(timeline?.items || []);
  const topTranscript = (transcript?.messages || []).slice(0, 4);
  return (
    <main className="usage-detail">
      <section className="usage-overview" aria-label="Selected session overview">
        <div className="usage-overview__copy">
          <p className="usage-eyebrow">{compactMeta([detail.session.provider, detail.session.model]) || "Session"}</p>
          <h1>{cleanTitle(detail.session.title)}</h1>
          <p>{formatRange(detail.session.startedAt, detail.session.endedAt)}</p>
        </div>
        <NextActions actions={detail.nextActions} />
      </section>

      <section className="usage-metric-strip" aria-label="Session metrics">
        {detail.summaryCards.filter((card) => card.label !== "Caveats").slice(0, 4).map((card) => (
          <div key={card.label} className="usage-stat">
            <span className="usage-stat__label">{card.label}</span>
            <strong>{formatMetric(card.value, card.unit)}</strong>
            {confidence(card.confidence) ? <span className="usage-stat__confidence">{confidence(card.confidence)}</span> : null}
          </div>
        ))}
      </section>

      <CaveatSummary caveats={caveats} />

      <div className="usage-content-grid">
        <section className="usage-panel usage-panel--timeline">
          <SectionHeader title="Time and tools" meta={topTimeline.length ? `${topTimeline.length} highest-cost steps` : undefined} />
          {topTimeline.length ? <TimelineBarChart items={topTimeline} metric="selfDurationMs" tableFallback={false} /> : <EmptyState title="No timeline data" />}
        </section>

        <section className="usage-panel usage-panel--transcript">
          <SectionHeader title="Transcript preview" meta={topTranscript.length ? `${topTranscript.length} messages` : undefined} />
          <div className="usage-transcript-preview">
            {topTranscript.map((message) => (
              <TranscriptMessage
                key={message.id}
                role={message.role}
                at={formatDate(message.at)}
                title={message.title}
                textPreview={message.textPreview}
                tokens={message.tokens}
                toolCalls={message.toolCalls}
                confidence={message.confidence}
              />
            ))}
          </div>
        </section>
      </div>

      <details className="usage-metadata">
        <summary>Raw metadata</summary>
        <JsonInspector value={{ session: detail.session, timeline, caveats }} />
      </details>
    </main>
  );
}

/** Renders a timeline-focused Usage view without reloading the app. */
function TimelineDetail({ detail, timeline, caveats }: { detail: UsageSessionDetailView; timeline?: UsageTimelineView; caveats: string[] }): React.ReactElement {
  const items = (timeline?.items || []).filter((item) => (item.metricValue || item.durationMs || 0) > 0).slice(0, 80);
  const topItems = topTimelineItems(timeline?.items || []);
  return (
    <main className="usage-detail usage-detail--timeline">
      <section className="usage-overview" aria-label="Selected timeline overview">
        <div className="usage-overview__copy">
          <p className="usage-eyebrow">{compactMeta([detail.session.provider, detail.session.model]) || "Timeline"}</p>
          <h1>Timeline for {cleanTitle(detail.session.title)}</h1>
          <p>{items.length ? `${items.length} timed steps from ${formatRange(detail.session.startedAt, detail.session.endedAt)}` : "No timed steps found for this session."}</p>
        </div>
        <NextActions actions={detail.nextActions} />
      </section>

      <section className="usage-metric-strip" aria-label="Timeline metrics">
        {detail.summaryCards.filter((card) => card.label !== "Caveats").slice(0, 4).map((card) => (
          <div key={card.label} className="usage-stat">
            <span className="usage-stat__label">{card.label}</span>
            <strong>{formatMetric(card.value, card.unit)}</strong>
            {confidence(card.confidence) ? <span className="usage-stat__confidence">{confidence(card.confidence)}</span> : null}
          </div>
        ))}
      </section>

      <CaveatSummary caveats={caveats} />

      <section className="usage-panel usage-panel--timeline-full">
        <SectionHeader title="Selected timeline" meta={items.length ? `${items.length} steps with table fallback` : undefined} />
        {items.length ? <TimelineBarChart items={items} metric="selfDurationMs" /> : <EmptyState title="No timeline data" />}
      </section>

      <section className="usage-panel usage-panel--costs">
        <SectionHeader title="Highest-cost steps" meta={topItems.length ? `${topItems.length} steps` : undefined} />
        {topItems.length ? (
          <div className="usage-ranked-list">
            {topItems.map((item, index) => (
              <div key={item.id} className="usage-ranked-row">
                <span>{index + 1}</span>
                <strong>{item.label}</strong>
                <em>{formatDuration(item.metricValue || item.durationMs)}</em>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No ranked steps" />}
      </section>
    </main>
  );
}

/** Renders provider/model context for the selected Usage session. */
function ProviderDetail({ detail, caveats }: { detail: UsageSessionDetailView; caveats: string[] }): React.ReactElement {
  const fields = [
    ["Provider", detail.session.provider || "Unknown"],
    ["Model", detail.session.model || "Unknown"],
    ["Session", detail.session.id],
    ["Tokens", detail.session.tokensTotal === undefined ? "Unknown" : `${formatMetric(detail.session.tokensTotal, "tokens")} tokens`],
    ["Tool calls", detail.session.toolCalls === undefined ? "Unknown" : String(detail.session.toolCalls)],
    ["Caveats", String(caveats.length)]
  ];
  return (
    <main className="usage-detail usage-detail--providers">
      <section className="usage-overview" aria-label="Provider coverage overview">
        <div className="usage-overview__copy">
          <p className="usage-eyebrow">Provider coverage</p>
          <h1>{compactMeta([detail.session.provider, detail.session.model]) || "Provider details"}</h1>
          <p>Normalized provider context for the selected session.</p>
        </div>
        <NextActions actions={detail.nextActions} />
      </section>

      <CaveatSummary caveats={caveats} />

      <section className="usage-provider-grid" aria-label="Provider fields">
        {fields.map(([label, value]) => (
          <div key={label} className="usage-provider-field">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <details className="usage-metadata">
        <summary>Raw provider metadata</summary>
        <JsonInspector value={{ session: detail.session, caveats }} />
      </details>
    </main>
  );
}

/** Renders section header text for Usage panels. */
function SectionHeader({ title, meta }: { title: string; meta?: string }): React.ReactElement {
  return (
    <header className="usage-section-header">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </header>
  );
}

/** Renders next actions for the selected session. */
function NextActions({ actions }: { actions: UsageSessionDetailView["nextActions"] }): React.ReactElement {
  const visible = actions.slice(0, 4);
  return (
    <nav className="usage-actions" aria-label="Next actions">
      {visible.map((action, index) => <a key={action.id} data-primary={index === 0 || undefined} href={action.href || "#"}>{action.label}</a>)}
    </nav>
  );
}

/** Renders caveats as progressive disclosure. */
function CaveatSummary({ caveats }: { caveats: string[] }): React.ReactElement | null {
  if (!caveats.length) return null;
  return (
    <details className="usage-caveats">
      <summary>
        <span>{caveats.length} caveats affect these numbers</span>
        <em>{caveatPreview(caveats[0])}</em>
      </summary>
      <ul>
        {caveats.map((caveat) => <li key={caveat}>{caveatPreview(caveat)}</li>)}
      </ul>
    </details>
  );
}

/** Selects the most informative timeline items for the default view. */
function topTimelineItems(items: UsageTimelineView["items"]): UsageTimelineView["items"] {
  return [...items]
    .filter((item) => (item.metricValue || item.durationMs || 0) > 0)
    .sort((a, b) => (b.metricValue || b.durationMs || 0) - (a.metricValue || a.durationMs || 0))
    .slice(0, 8);
}

/** Reads the initial Usage subview from the local route. */
function initialUsageView(): UsageView {
  if (typeof window === "undefined") return "sessions";
  if (window.location.pathname.endsWith("/usage/timeline")) return "timeline";
  if (window.location.pathname.endsWith("/usage/providers")) return "providers";
  return "sessions";
}

/** Maps shell nav items to Usage subviews. */
function usageViewForNavItem(id: string): UsageView {
  if (id === "timeline") return "timeline";
  if (id === "providers") return "providers";
  return "sessions";
}

/** Formats a duration for ranked timeline rows. */
function formatDuration(value: number | undefined): string {
  if (value === undefined) return "Unknown";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

/** Formats compact metadata. */
function compactMeta(values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" · ");
}

/** Cleans session titles for a compact product UI. */
function cleanTitle(value: string | undefined): string {
  const text = (value || "Untitled session").replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

/** Converts low-signal provider caveats into short user-facing copy. */
function caveatPreview(value: string | undefined): string {
  if (!value) return "Partial provider metadata.";
  if (/Maximum call stack size exceeded/i.test(value)) return "Some deep provider metadata was too large to inspect.";
  if (/Imported from/i.test(value)) return "Some fields are normalized from provider-native transcripts.";
  return value;
}

/** Converts API/runtime errors into user-facing copy. */
function friendlyError(value: string): string {
  if (value.includes("<!doctype")) return "Usage API unavailable. Start the app with `tangent usage ui`.";
  return value;
}

/** Formats a date for compact product UI. */
function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Formats a session time range. */
function formatRange(startedAt: string | undefined, endedAt: string | undefined): string {
  const start = formatDate(startedAt);
  const end = formatDate(endedAt);
  if (start && end) return `${start} to ${end}`;
  return start || "Time range unknown";
}

/** Normalizes Usage confidence values for shared metric components. */
function confidence(value: string | undefined): Confidence | undefined {
  if (value === "exact" || value === "derived" || value === "partial" || value === "estimated" || value === "unknown") return value;
  if (value === "provider-reported") return "exact";
  if (value === "unsupported") return "unknown";
  return undefined;
}

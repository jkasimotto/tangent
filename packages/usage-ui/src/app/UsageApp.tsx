import React, { useEffect, useMemo, useState } from "react";
import { createUsageApiClient, type UsageCockpitView, type UsageSessionListItem, type UsageUiClient } from "@tangent/usage-ui-data";
import { TangentAppShell, type TangentNavItem, type TangentNavModel } from "@tangent/ui-app-shell";
import { EmptyState, Spinner } from "@tangent/ui-primitives";
import { UsageCockpitPage } from "../pages/UsageCockpitPage.js";
import { UsageProvidersPage } from "../pages/UsageProvidersPage.js";

export type UsageAppProps = {
  client?: UsageUiClient;
};

type UsageScreenState = {
  sessions: UsageSessionListItem[];
  selectedId?: string;
  cockpit?: UsageCockpitView;
  loading: boolean;
  error?: string;
};

type UsageView = "home" | "sessions" | "active" | "costly" | "slow" | "errors" | "providers";

/** Renders the UsageApp UI. */
export function UsageApp({ client }: UsageAppProps = {}): React.ReactElement {
  const usageClient = useMemo(() => client || createUsageApiClient(), [client]);
  const [state, setState] = useState<UsageScreenState>({ sessions: [], loading: true });
  const [view, setView] = useState<UsageView>(() => initialUsageView());

  useEffect(() => {
    let cancelled = false;
        /** Supports the load sessions helper. */
const loadSessions = async () => {
      try {
        const list = await usageClient.listSessions({ limit: 50 });
        if (cancelled) return;
        const selectedId = bestSessionCandidate(list.sessions)?.id;
        setState((current) => ({
          ...current,
          sessions: list.sessions,
          selectedId,
          loading: false,
          error: undefined
        }));
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: (error as Error).message }));
      }
    };
    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [usageClient]);

  useEffect(() => {
    if (!state.selectedId) return;
    let cancelled = false;
    setState((current) => ({ ...current, cockpit: undefined }));
        /** Supports the load cockpit helper. */
const loadCockpit = async () => {
      try {
        const cockpit = await usageClient.getCockpit(state.selectedId!);
        if (!cancelled) setState((current) => ({ ...current, cockpit, error: undefined }));
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, error: (error as Error).message }));
      }
    };
    void loadCockpit();
    return () => {
      cancelled = true;
    };
  }, [state.selectedId, usageClient]);

  const nav: TangentNavModel = {
    product: "usage",
    sections: [{
      label: "Usage",
      items: [
        { id: "home", label: "Home", href: "/usage" },
        { id: "sessions", label: "Sessions", href: "/usage/sessions" },
        { id: "active", label: "Active", href: "/usage/active" },
        { id: "costly", label: "Costly", href: "/usage/costly" },
        { id: "slow", label: "Slow", href: "/usage/slow" },
        { id: "errors", label: "Errors", href: "/usage/errors" },
        { id: "providers", label: "Providers", href: "/usage/providers" }
      ]
    }]
  };

  useEffect(() => {
        /** Supports the on pop state helper. */
const onPopState = () => setView(initialUsageView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

    /** Supports the navigate helper. */
const navigate = (item: TangentNavItem) => {
    const nextView = usageViewForNavItem(item.id);
    setView(nextView);
    if (window.location.pathname !== item.href) window.history.pushState({}, "", item.href);
  };

  return (
    <TangentAppShell nav={nav} activeItemId={view} onNavigate={navigate}>
      <UsageScreen
        state={state}
        view={view}
        onSelectSession={(selectedId) => setState((current) => ({ ...current, selectedId }))}
      />
    </TangentAppShell>
  );
}

/** Renders the UsageScreen UI. */
function UsageScreen({
  state,
  view,
  onSelectSession
}: {
  state: UsageScreenState;
  view: UsageView;
  onSelectSession(id: string): void;
}): React.ReactElement {
  if (state.error) {
    return <main className="usage-loading"><EmptyState title="Usage data unavailable"><p>{friendlyError(state.error)}</p></EmptyState></main>;
  }
  if (state.loading || (state.selectedId && !state.cockpit)) {
    return <main className="usage-loading"><Spinner /></main>;
  }
  if (!state.selectedId || !state.cockpit) {
    return <main className="usage-loading"><EmptyState title="No sessions found"><p>Run `tangent usage status` to check native transcript discovery.</p></EmptyState></main>;
  }
  if (view === "providers") return <UsageProvidersPage cockpit={state.cockpit} />;
  return <UsageCockpitPage cockpit={state.cockpit} onSelectSession={onSelectSession} />;
}

/** Supports the best session candidate helper. */
function bestSessionCandidate(sessions: UsageSessionListItem[]): UsageSessionListItem | undefined {
  return sessions.find((session) => session.status === "active")
    || sessions[0]
    || [...sessions].sort((left, right) => (right.tokensTotal || 0) - (left.tokensTotal || 0))[0];
}

/** Reads the initial usage view. */
function initialUsageView(): UsageView {
  if (typeof window === "undefined") return "home";
  const path = window.location.pathname;
  if (path.endsWith("/usage/providers")) return "providers";
  if (path.endsWith("/usage/errors")) return "errors";
  if (path.endsWith("/usage/slow")) return "slow";
  if (path.endsWith("/usage/costly")) return "costly";
  if (path.endsWith("/usage/active")) return "active";
  if (path.endsWith("/usage/sessions")) return "sessions";
  return "home";
}

/** Supports the usage view for nav item helper. */
function usageViewForNavItem(id: string): UsageView {
  if (id === "providers" || id === "errors" || id === "slow" || id === "costly" || id === "active" || id === "sessions") return id;
  return "home";
}

/** Builds friendly error copy. */
function friendlyError(value: string): string {
  if (value.includes("<!doctype")) return "Usage API unavailable. Start the app with `tangent usage ui`.";
  return value;
}

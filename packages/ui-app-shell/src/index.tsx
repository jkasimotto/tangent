import React, { type ReactNode } from "react";
import { AppFrame } from "@tangent/ui-patterns";
import { Badge, Button, SearchField, type ActionModel } from "@tangent/ui-primitives";

export type TangentNavModel = {
  product: "usage" | "eval" | "rollup" | string;
  sections: Array<{
    label?: string;
    items: Array<{
      id: string;
      label: string;
      href: string;
      icon?: string;
      badge?: string | number;
    }>;
  }>;
  actions?: ActionModel[];
};

/** Renders the TangentAppShell UI. */
export function TangentAppShell({
  nav,
  repo,
  inspector,
  children
}: {
  nav: TangentNavModel;
  repo?: string;
  inspector?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <AppFrame
      topBar={<TopBar nav={nav} repo={repo} />}
      sidebar={<PackageNavigation nav={nav} />}
      inspector={inspector}
    >
      {children}
    </AppFrame>
  );
}

/** Renders the TangentRouter UI. */
export function TangentRouter({ children }: { children: ReactNode }): React.ReactElement {
  return <>{children}</>;
}

/** Renders the PackageSwitcher UI. */
export function PackageSwitcher({ product }: { product: string }): React.ReactElement {
  return <Badge tone="accent">{product}</Badge>;
}

/** Renders the RepoSelector UI. */
export function RepoSelector({ repo = "." }: { repo?: string }): React.ReactElement {
  return <span className="tg-repo-selector">{repo}</span>;
}

/** Renders the GlobalSearch UI. */
export function GlobalSearch(): React.ReactElement {
  return <SearchField label="Global search" placeholder="Search sessions, runs, messages" />;
}

/** Renders the CommandPalette UI. */
export function CommandPalette({ actions = [] }: { actions?: ActionModel[] }): React.ReactElement {
  return <div className="tg-command-palette">{actions.map((action) => <Button key={action.id || action.label} variant="ghost" onClick={action.onAction}>{action.label}</Button>)}</div>;
}

/** Renders the AppNotifications UI. */
export function AppNotifications({ count = 0 }: { count?: number }): React.ReactElement {
  return <Badge tone={count ? "warning" : "neutral"}>{count} notices</Badge>;
}

/** Renders the LocalServerStatus UI. */
export function LocalServerStatus({ url }: { url?: string }): React.ReactElement {
  return <Badge tone={url ? "success" : "neutral"}>{url ? "Local server" : "Offline"}</Badge>;
}

/** Renders the TopBar UI. */
function TopBar({ nav, repo }: { nav: TangentNavModel; repo?: string }): React.ReactElement {
  return (
    <div className="tg-shell-topbar">
      <PackageSwitcher product={nav.product} />
      <RepoSelector repo={repo} />
      <GlobalSearch />
      <CommandPalette actions={nav.actions} />
      <AppNotifications />
    </div>
  );
}

/** Renders the PackageNavigation UI. */
function PackageNavigation({ nav }: { nav: TangentNavModel }): React.ReactElement {
  return (
    <nav className="tg-shell-nav" aria-label={`${nav.product} navigation`}>
      {nav.sections.map((section, index) => (
        <section key={section.label || index}>
          {section.label ? <h2>{section.label}</h2> : null}
          {section.items.map((item) => (
            <a key={item.id} href={item.href}>
              <span>{item.label}</span>
              {item.badge !== undefined ? <Badge>{String(item.badge)}</Badge> : null}
            </a>
          ))}
        </section>
      ))}
    </nav>
  );
}

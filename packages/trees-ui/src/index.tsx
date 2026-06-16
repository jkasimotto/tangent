import React, { useEffect, useMemo, useState } from "react";
import { createTreesCenterApiClient, type TreesCenterClient, type TreesCenterView, type TreesTreeNode } from "@tangent/trees-ui-data";
import { TangentAppShell, type TangentNavModel } from "@tangent/ui-app-shell";
import { PageHeader, ResourceList } from "@tangent/ui-components";
import { Badge, Button, EmptyState, Spinner } from "@tangent/ui-primitives";

export type TreesAppProps = {
  client?: TreesCenterClient;
  initialPath?: string;
};

type TreesAppState = {
  view?: TreesCenterView;
  selectedPath?: string;
  loading: boolean;
  error?: string;
};

/** Documents the TreesApp helper. */
export function TreesApp({ client, initialPath }: TreesAppProps = {}): React.ReactElement {
  const centerClient = useMemo(() => client || createTreesCenterApiClient(), [client]);
  const [state, setState] = useState<TreesAppState>({ selectedPath: initialPath, loading: true });

  useEffect(() => {
    let cancelled = false;
    /** Documents the load helper. */
    const load = async () => {
      try {
        const view = await centerClient.getCenter(state.selectedPath);
        if (!cancelled) setState((current) => ({ ...current, view, loading: false, error: undefined }));
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: (error as Error).message }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [centerClient, state.selectedPath]);

  const nav: TangentNavModel = {
    product: "trees",
    sections: [{ label: "Tangent Center", items: [
      { id: "tree", label: "Tree", href: "#tree", badge: state.view?.counts.entities },
      { id: "attention", label: "Attention", href: "#attention", badge: state.view?.counts.openAttention },
      { id: "agents", label: "Active agents", href: "#agents", badge: state.view?.counts.activeAgents }
    ] }]
  };

  return (
    <TangentAppShell nav={nav} inspector={<Inspector view={state.view} />}>
      <PageHeader
        title="Tangent Center"
        actions={<span className="trees-header-meta">{headerMeta(state.view)}</span>}
      />
      <main className="trees-center">
        <section id="tree" className="trees-panel trees-panel--tree" aria-label="Tree">
          <PanelHeader title="Tree" meta={state.view ? `${state.view.counts.entities} entities` : undefined} />
          {state.loading ? <Spinner /> : state.error ? <EmptyState title="Trees unavailable"><p>{state.error}</p></EmptyState> : <TreeList nodes={state.view?.tree || []} selectedPath={state.selectedPath} onSelect={(selectedPath) => setState((current) => ({ ...current, selectedPath }))} />}
        </section>
        <section className="trees-workspace" aria-label="Attention and active work">
          <section id="attention" className="trees-panel">
            <PanelHeader title="Needs attention" meta={state.view ? `${state.view.counts.openAttention} open` : undefined} />
            <AttentionList view={state.view} />
          </section>
          <section id="agents" className="trees-panel">
            <PanelHeader title="Active agents" meta={state.view ? `${state.view.counts.activeAgents} running` : undefined} />
            <ActiveAgents view={state.view} />
          </section>
        </section>
      </main>
    </TangentAppShell>
  );
}

/** Documents the TreeList helper. */
function TreeList({ nodes, selectedPath, onSelect }: { nodes: TreesTreeNode[]; selectedPath?: string; onSelect(path: string): void }): React.ReactElement {
  if (!nodes.length) return <EmptyState title="No tree entities"><p>Create one with `tangent trees add project/feature`.</p></EmptyState>;
  return <div className="trees-tree-list">{nodes.map((node) => <TreeNode key={node.id} node={node} selectedPath={selectedPath} onSelect={onSelect} />)}</div>;
}

/** Documents the TreeNode helper. */
function TreeNode({ node, selectedPath, onSelect }: { node: TreesTreeNode; selectedPath?: string; onSelect(path: string): void }): React.ReactElement {
  const selected = selectedPath === node.path;
  return (
    <div className="trees-tree-node">
      <button className={selected ? "trees-tree-node__button is-selected" : "trees-tree-node__button"} type="button" onClick={() => onSelect(node.path)}>
        <span>{node.title}</span>
        <span className="trees-tree-node__meta">
          {node.kind}
          {node.attentionOpen ? <Badge tone="warning">{node.attentionOpen}</Badge> : null}
        </span>
      </button>
      {node.children.length ? <div className="trees-tree-node__children">{node.children.map((child) => <TreeNode key={child.id} node={child} selectedPath={selectedPath} onSelect={onSelect} />)}</div> : null}
    </div>
  );
}

/** Documents the AttentionList helper. */
function AttentionList({ view }: { view?: TreesCenterView }): React.ReactElement {
  if (!view?.attention.length) return <EmptyState title="No open attention" />;
  return (
    <ResourceList
      items={view.attention.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.body || item.entityPath,
        meta: [item.kind, item.entityPath].filter((value): value is string => Boolean(value)),
        badges: [{ label: item.severity, tone: toneForSeverity(item.severity) }]
      }))}
    />
  );
}

/** Documents the ActiveAgents helper. */
function ActiveAgents({ view }: { view?: TreesCenterView }): React.ReactElement {
  if (!view?.activeAgents.length) return <EmptyState title="No active agents" />;
  return (
    <ResourceList
      items={view.activeAgents.map((run) => ({
        id: run.id,
        title: run.entityPath || run.id,
        subtitle: run.statusReason || run.adapterId,
        meta: [run.adapterId, run.lastActivityAt ? `activity ${formatRelative(run.lastActivityAt)}` : undefined].filter((value): value is string => Boolean(value)),
        status: run.status
      }))}
    />
  );
}

/** Documents the Inspector helper. */
function Inspector({ view }: { view?: TreesCenterView }): React.ReactElement {
  const selected = view?.selected;
  if (!selected?.entity) return <aside className="trees-inspector"><EmptyState title="Select an entity" /></aside>;
  return (
    <aside className="trees-inspector">
      <h2>{selected.entity.title}</h2>
      <p className="trees-inspector__path">{selected.entity.path}</p>
      <div className="trees-inspector__badges">
        <Badge>{selected.entity.kind}</Badge>
        {selected.entity.branch ? <Badge tone="info">{selected.entity.branch}</Badge> : null}
        {selected.attention.length ? <Badge tone="warning">{selected.attention.length} attention</Badge> : null}
      </div>
      <dl className="trees-inspector__facts">
        <dt>Worktree</dt><dd>{selected.entity.worktreePath || "None"}</dd>
        <dt>Repo</dt><dd>{selected.entity.repoRoot || "None"}</dd>
        <dt>Sessions</dt><dd>{selected.workSessions.length}</dd>
        <dt>Agents</dt><dd>{selected.agentRuns.length}</dd>
      </dl>
      <div className="trees-inspector__actions">
        <Button variant="primary">Open</Button>
        <Button variant="secondary">Checkpoint</Button>
      </div>
    </aside>
  );
}

/** Documents the PanelHeader helper. */
function PanelHeader({ title, meta }: { title: string; meta?: string }): React.ReactElement {
  return <header className="trees-panel__header"><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</header>;
}

/** Documents the headerMeta helper. */
function headerMeta(view: TreesCenterView | undefined): string {
  if (!view) return "Loading";
  return `${view.counts.openAttention} attention · ${view.counts.activeAgents} agents · ${view.counts.activeSessions} sessions`;
}

/** Documents the toneForSeverity helper. */
function toneForSeverity(severity: string): "neutral" | "accent" | "success" | "warning" | "danger" | "info" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

/** Documents the formatRelative helper. */
function formatRelative(value: string): string {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return value;
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

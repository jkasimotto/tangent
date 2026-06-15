import React, { useEffect, useMemo, useState } from "react";
import { createEvalServerClient, type EvalCompareView, type EvalRunDetailView } from "@tangent/eval-ui-data";
import { TangentAppShell, type TangentNavModel } from "@tangent/ui-app-shell";
import { EmptyState, Spinner } from "@tangent/ui-primitives";

import { ComparePage } from "../pages/ComparePage.js";
import { RunPage } from "../pages/RunPage.js";

/** Renders the EvalApp UI. */
export function EvalApp(): React.ReactElement {
  const client = useMemo(() => createEvalServerClient(), []);
  const [run, setRun] = useState<EvalRunDetailView>();
  const [compare, setCompare] = useState<EvalCompareView>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    /** Loads load. */
    async function load(): Promise<void> {
      try {
        const runs = await client.listRuns();
        const selected = runs[0];
        if (!selected) return;
        const detail = await client.getRun("selected");
        if (cancelled) return;
        setRun(detail);
        const firstCase = detail.cases[0];
        const [left, right] = firstCase?.variants || [];
        if (firstCase && left && right) {
          setCompare(await client.getCompare({ runId: selected.id, caseId: firstCase.caseId, left: left.variantId, right: right.variantId, phase: "impl" }));
        }
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const nav: TangentNavModel = {
    product: "eval",
    sections: [
      { label: "Eval", items: [
        { id: "home", label: "Home", href: "/eval" },
        { id: "specs", label: "Specs", href: "/eval/specs" },
        { id: "runs", label: "Runs", href: "/eval/runs" }
      ] }
    ],
    actions: [{
      id: "refresh",
      label: "Refresh",
      /** Reloads the eval data view. */
      onAction: () => location.reload()
    }]
  };

  return (
    <TangentAppShell nav={nav}>
      {error ? <EmptyState title="Eval data unavailable"><p>{error}</p></EmptyState> : !run ? <Spinner /> : compare ? <ComparePage run={run} compare={compare} /> : <RunPage run={run} />}
    </TangentAppShell>
  );
}

import React from "react";
import type { UsageSessionHeroView } from "@tangent/usage-ui-data";
import { PrimaryFinding } from "../Diagnostics/PrimaryFinding.js";
import { SessionActionDock } from "./SessionActionDock.js";

/** Renders the SessionHero UI. */
export function SessionHero({ session }: { session: UsageSessionHeroView }): React.ReactElement {
  const metadata = [session.timeRangeLabel, session.repoLabel, session.branchLabel].filter(Boolean).join(" · ");
  return (
    <section className="usage-session-hero" aria-label="Selected session">
      <div className="usage-session-hero__body">
        <p className="usage-kicker">{session.provider.toUpperCase()} · {session.status.toUpperCase()}</p>
        <h1>{session.title}</h1>
        <p className="usage-session-hero__meta">{metadata}</p>
        <p className="usage-session-hero__summary">{session.summary}</p>
        <PrimaryFinding finding={session.primaryFinding} />
      </div>
      <SessionActionDock actions={session.actions} />
    </section>
  );
}

// The veil shown while an Area's resource catalog and a Map source save together. It is a passive
// status: it takes no focus, it has no button, and it says which of the two transactions is
// running so a person knows the Map is not merely slow. `surfaces/surface-registry.ts` declares it
// as the `transaction` surface on the toast layer, which is why nothing here positions it.

import type { ReactNode } from "react";
import { TRANSACTION } from "../../copy.ts";
import type { ResourcesState } from "./resources-state.ts";

export type TransactionStatusProps = {
  readonly state: ResourcesState;
};

/** Renders the transaction veil while a scene-coupled resource change is saving. */
export function TransactionStatus(props: TransactionStatusProps): ReactNode {
  const busy = props.state.sceneBusy;
  if (!busy) return null;
  return (
    <div className="tangent-map-resource-transaction" role="status" aria-live="polite">
      <strong>{busy.label}</strong>
      <span>{TRANSACTION.saving}</span>
    </div>
  );
}

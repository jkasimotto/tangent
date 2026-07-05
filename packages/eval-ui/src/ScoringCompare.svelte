<script lang="ts">
  import type { EvalScoringView } from "./client.js";
  import { scoringCell, scoringTotalLabel } from "./compare-model.js";

  export let view: EvalScoringView | undefined;
  export let loading = false;
  export let errorText = "";

  $: columns = view?.variants ?? [];
  $: criteria = view?.criteria ?? [];
</script>

<div class="scoring" aria-label="Scoring comparison">
  {#if loading}
    <div class="state">Loading scoring…</div>
  {:else if errorText}
    <div class="notice" role="alert">{errorText}</div>
  {:else if columns.length === 0}
    <div class="state">No scoring data for this case.</div>
  {:else}
    <div class="scoring-header" style={`grid-template-columns: repeat(${columns.length}, minmax(0, 1fr));`}>
      {#each columns as column (column.key)}
        <div class="scoring-col-head">
          <span class="scoring-label">
            {column.label}
            {#if column.isBaseline}<span class="scoring-baseline-tag">baseline</span>{/if}
          </span>
          {#if scoringTotalLabel(column)}<span class="scoring-total">{scoringTotalLabel(column)}</span>{/if}
        </div>
      {/each}
    </div>

    {#each criteria as criterion (criterion.id)}
      <div class="scoring-criterion">
        <p class="scoring-statement">{criterion.statement}</p>
        <div class="scoring-sides" style={`grid-template-columns: repeat(${columns.length}, minmax(0, 1fr));`}>
          {#each columns as column (column.key)}
            {@const cell = scoringCell(criterion, column.key)}
            <div class="scoring-side">
              {#if cell && cell.passed !== undefined}
                <span class="scoring-glyph scoring-{cell.passed ? 'pass' : 'fail'}">{cell.passed ? "✓" : "✗"}</span>
                {#if cell.reasoning}<p class="scoring-reasoning">{cell.reasoning}</p>{/if}
              {:else}
                <span class="scoring-absent">absent</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}

    {#if view?.warnings?.length}
      <div class="scoring-warnings">
        {#each view.warnings as warning}
          <p class="convo-note">{warning}</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>

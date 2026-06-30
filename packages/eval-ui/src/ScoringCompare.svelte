<script lang="ts">
  import type { EvalEvaluationView } from "./client.js";

  export let left: EvalEvaluationView | null | undefined;
  export let right: EvalEvaluationView | null | undefined;
  export let leftLabel = "";
  export let rightLabel = "";

  // Use the left side's criteria as the canonical rubric; both sides share the same rubric.
  $: criteria = left?.criteria ?? right?.criteria ?? [];
</script>

<div class="scoring" aria-label="Scoring comparison">
  <div class="scoring-header">
    {#each [{ key: "a", label: leftLabel, ev: left }, { key: "b", label: rightLabel, ev: right }] as side (side.key)}
      <div class="scoring-col-head scoring-col-{side.key}">
        <span class="scoring-label">{side.label}</span>
        {#if side.ev}
          <span class="scoring-total">{side.ev.totalPoints} / {side.ev.maxPoints} pts</span>
        {/if}
      </div>
    {/each}
  </div>

  {#each criteria as criterion (criterion.id)}
    {@const leftC = left?.criteria.find((c) => c.id === criterion.id)}
    {@const rightC = right?.criteria.find((c) => c.id === criterion.id)}
    <div class="scoring-criterion">
      <p class="scoring-statement">{criterion.statement}</p>
      <div class="scoring-sides">
        <div class="scoring-side scoring-side-a">
          {#if leftC !== undefined}
            <span class="scoring-glyph scoring-{leftC.passed ? 'pass' : 'fail'}">{leftC.passed ? "✓" : "✗"}</span>
            <span class="scoring-pts">{leftC.points}pt</span>
            <p class="scoring-reasoning">{leftC.reasoning}</p>
          {:else}
            <span class="scoring-absent">absent</span>
          {/if}
        </div>
        <div class="scoring-side scoring-side-b">
          {#if rightC !== undefined}
            <span class="scoring-glyph scoring-{rightC.passed ? 'pass' : 'fail'}">{rightC.passed ? "✓" : "✗"}</span>
            <span class="scoring-pts">{rightC.points}pt</span>
            <p class="scoring-reasoning">{rightC.reasoning}</p>
          {:else}
            <span class="scoring-absent">absent</span>
          {/if}
        </div>
      </div>
    </div>
  {/each}

  {#if left?.warnings?.length || right?.warnings?.length}
    <div class="scoring-warnings">
      {#each left?.warnings ?? [] as warning}
        <p class="convo-note">{warning}</p>
      {/each}
      {#each right?.warnings ?? [] as warning}
        <p class="convo-note">{warning}</p>
      {/each}
    </div>
  {/if}
</div>

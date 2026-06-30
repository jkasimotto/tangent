<script lang="ts">
  import type { EvalAssembledContext } from "./client.js";
  import { concatBlocks, alignBySource } from "./assembled-model.js";

  export let left: EvalAssembledContext | undefined;
  export let right: EvalAssembledContext | undefined;
  export let leftLabel = "";
  export let rightLabel = "";
  export let loading = false;
  export let errorText = "";

  // Maps each source to its A/B difference status, so a divider can show "only here" / "differs".
  $: statusBySource = (() => {
    const map = new Map<string, string>();
    if (left && right) for (const row of alignBySource(left.blocks, right.blocks)) map.set(row.source, row.status);
    return map;
  })();
  /** A short difference tag for a block, from this side's perspective. */
  function diffTag(source: string, sideKey: string): string {
    const status = statusBySource.get(source);
    if (status === "changed") return "differs";
    if ((status === "left-only" && sideKey === "a") || (status === "right-only" && sideKey === "b")) return "only here";
    return "";
  }

  /** Copies a side's verbatim concatenation (no provenance dividers). */
  async function copySide(ctx: EvalAssembledContext | undefined): Promise<void> {
    if (!ctx) return;
    await navigator.clipboard?.writeText(concatBlocks(ctx.blocks));
  }

  /** A short divider label for a block, by kind. */
  function dividerLabel(kind: string, source: string): string {
    if (kind === "skills-index") return "Skills index (frontmatter, always loaded)";
    if (kind === "skill-body") return `SKILL: ${source} (body, loaded)`;
    if (kind === "subagents-index") return "Subagents (metadata only, not in context)";
    if (kind === "import") return `${source} (imported)`;
    return source;
  }

</script>

<div class="assembled" aria-label="Assembled context">
  {#if errorText}
    <p class="assembled-error">{errorText}</p>
  {:else}
    <div class="assembled-cols">
      {#each [{ key: "a", label: leftLabel, ctx: left }, { key: "b", label: rightLabel, ctx: right }] as side (side.key)}
        <div class="assembled-col assembled-{side.key}" aria-busy={loading}>
          <div class="assembled-col-head">
            <span class="assembled-label">{side.label}</span>
            <button type="button" class="assembled-copy" aria-label={`Copy ${side.label} context`} on:click={() => copySide(side.ctx)}>copy</button>
          </div>
          {#if loading && !side.ctx}
            <div class="state">Assembling…</div>
          {:else if !side.ctx || side.ctx.blocks.length === 0}
            <p class="assembled-empty">No repo context loads at this path.</p>
          {:else}
            {#each side.ctx.blocks as block, i (`${block.source}:${i}`)}
              {@const tag = diffTag(block.source, side.key)}
              <div class="assembled-block assembled-{block.kind}">
                <div class="assembled-divider" class:differs={tag === "differs"}>
                  {dividerLabel(block.kind, block.source)}
                  {#if tag}<span class="diff-tag">{tag}</span>{/if}
                </div>
                <pre class="assembled-text">{block.text}</pre>
              </div>
            {/each}
            {#if side.ctx.lazyClaudeMd.length}
              <details class="assembled-lazy">
                <summary>Below cwd, loads lazily (not at start): {side.ctx.lazyClaudeMd.length}</summary>
                <ul>{#each side.ctx.lazyClaudeMd as path}<li>{path}</li>{/each}</ul>
              </details>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

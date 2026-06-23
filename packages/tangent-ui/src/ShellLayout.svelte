<script lang="ts">
  export let chromeHidden = false;
</script>

<main class="tangent-shell">
  <header class="shell-chrome" class:hidden={chromeHidden}>
    <slot name="chrome"></slot>
  </header>
  <section class="shell-workspace">
    <slot></slot>
  </section>
</main>

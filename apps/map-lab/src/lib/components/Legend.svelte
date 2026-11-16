<script lang="ts">
  import type { VariableInfo } from "@similie/4shadow";

  let { info, label }: { info: VariableInfo; label: string } = $props();

  const stops = $derived(info.legend?.stops ?? []);
  // Stops sit at equal spacing (like the server's legend), so uneven scales such as rain stay readable.
  const gradient = $derived(
    `linear-gradient(to right, ${stops.map((s, i) => `${cssColor(s.color)} ${((i / Math.max(1, stops.length - 1)) * 100).toFixed(2)}%`).join(", ")})`,
  );
  const every = $derived(stops.length > 9 ? 2 : 1);

  function cssColor(hex: string): string {
    const h = hex.replace(/^#/, "");
    const [r, g, b, a] = [0, 2, 4, 6].map((i) => parseInt((h.length === 6 ? h + "ff" : h).slice(i, i + 2), 16));
    // Show translucent stops against the panel at full strength so the scale is legible.
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0.35, a! / 255).toFixed(2)})`;
  }

  /** Tick labels: whole thousands shortened from 10,000 up (visibility in m); pressure stays 1000, 1010. */
  function short(v: number): string {
    if (Math.abs(v) >= 10_000) return `${+(v / 1000).toFixed(1)}k`;
    return String(+v.toFixed(2));
  }
</script>

<div class="legend panel">
  <div class="title"><span>{label}</span><span class="units">{info.units}</span></div>
  <div class="bar" style:background={gradient}></div>
  <div class="ticks num">
    {#each stops as s, i (i)}
      {#if i % every === 0 || i === stops.length - 1}
        <span style:left="{(i / Math.max(1, stops.length - 1)) * 100}%">{short(s.value)}</span>
      {/if}
    {/each}
  </div>
</div>

<style>
  .legend {
    width: 300px;
    padding: 8px 12px 6px;
  }
  .title {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  .units {
    color: var(--muted);
  }
  .bar {
    height: 8px;
    border-radius: 4px;
  }
  .ticks {
    position: relative;
    height: 16px;
    margin: 3px 4px 0;
    font-size: 11px;
    color: var(--muted);
  }
  .ticks span {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }
</style>

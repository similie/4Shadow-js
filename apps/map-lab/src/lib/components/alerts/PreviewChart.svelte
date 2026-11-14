<script lang="ts">
  import type { AlertPreview } from "@similie/4shadow";
  import { ALERT_COLORS } from "#lib/alerts/alert-layers.ts";
  import { dayKey, formatDay, formatTime, formatValue } from "#lib/format.ts";

  /**
   * What a draft alert would see: one small chart per condition (they have different units), each the
   * area's value at every step against its threshold, with the times the alert's conditions are met
   * shaded. Click to move the map to that time.
   */
  let { preview, time, onSeek }: { preview: AlertPreview; time: number; onSeek: (ms: number) => void } = $props();

  const ROW = 56;
  const GAP = 12;
  /** Room above each chart for its name. */
  const LABEL = 16;
  const AXIS = 18;
  const PAD = 4;
  const OPS: Record<string, string> = { ">": ">", ">=": "≥", "<": "<", "<=": "≤" };

  let width = $state(380);
  let hover = $state<number | null>(null);

  const rows = $derived(preview.timeline ?? []);
  const times = $derived(rows.map((r) => Date.parse(r.time)));
  const t0 = $derived(times[0] ?? 0);
  const t1 = $derived(times[times.length - 1] ?? 1);
  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (width - 2 * PAD);
  const plotHeight = $derived(preview.conditions.length * (LABEL + ROW + GAP) - GAP);

  const series = $derived(
    preview.conditions.map((c, i) => {
      const values = rows.map((r) => r.values[i] ?? null);
      const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
      let lo = Math.min(c.threshold, ...finite);
      let hi = Math.max(c.threshold, ...finite);
      const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
      lo -= pad;
      hi += pad;
      const top = i * (LABEL + ROW + GAP) + LABEL;
      const y = (v: number) => top + ROW - ((v - lo) / (hi - lo)) * ROW;
      let d = "";
      let pen = false;
      values.forEach((v, k) => {
        if (v === null || !Number.isFinite(v)) return void (pen = false);
        d += `${pen ? "L" : "M"}${x(times[k]!).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      const decimals = Math.abs(hi - lo) < 5 ? 1 : 0;
      return { c, i, top, d, y, values, decimals, thresholdY: y(c.threshold), empty: finite.length === 0 };
    }),
  );

  /** Runs of steps where the alert's conditions are all met (or any, with match "any"). */
  const met = $derived.by(() => {
    const spans: Array<[number, number]> = [];
    let start: number | null = null;
    rows.forEach((r, k) => {
      if (r.met && start === null) start = k;
      if ((!r.met || k === rows.length - 1) && start !== null) {
        const end = r.met ? k : k - 1;
        const half = (k2: number, dir: -1 | 1) => (times[k2 + dir] !== undefined ? (times[k2]! - times[k2 + dir]!) / 2 : 0);
        spans.push([times[start]! + half(start, -1), times[end]! + half(end, 1)]);
        start = null;
      }
    });
    return spans;
  });

  const days = $derived.by(() => {
    const out: number[] = [];
    let key = "";
    for (let t = t0; t <= t1; t += 3_600_000) {
      const k = dayKey(t);
      if (k !== key && t !== t0) out.push(t);
      key = k;
    }
    return out;
  });

  /** The values at one step, for screen readers. */
  function readout(k: number | null): string {
    if (k === null) return formatTime(time);
    const parts = series.map((s) => `${s.c.name} ${formatValue(s.values[k], s.decimals)} ${s.c.units}`);
    return `${formatTime(times[k]!)}: ${parts.join(", ")}${rows[k]!.met ? ", conditions met" : ""}`;
  }

  function key(e: KeyboardEvent) {
    if (!times.length) return;
    const from = hover ?? Math.max(0, times.findIndex((t) => t >= time));
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const step = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 24 : 1);
      hover = Math.max(0, Math.min(times.length - 1, from + step));
    } else if (e.key === "Enter" || e.key === " ") {
      onSeek(times[from]!);
    } else return;
    e.preventDefault();
    e.stopPropagation(); // not the page's own arrow keys, which move the map's time
  }

  function nearest(clientX: number, el: Element): number | null {
    if (!times.length) return null;
    const r = el.getBoundingClientRect();
    const ms = t0 + ((clientX - r.left - PAD) / (r.width - 2 * PAD)) * (t1 - t0);
    let best = 0;
    for (let k = 1; k < times.length; k++) if (Math.abs(times[k]! - ms) < Math.abs(times[best]! - ms)) best = k;
    return best;
  }
</script>

<div class="chart" bind:clientWidth={width}>
  {#if rows.length}
    <svg
      {width}
      height={plotHeight + AXIS}
      role="slider"
      tabindex="0"
      aria-label="The area's forecast for each condition against its threshold. Arrow keys move through it, Enter shows that time on the map."
      aria-valuemin={t0}
      aria-valuemax={t1}
      aria-valuenow={hover !== null ? times[hover] : time}
      aria-valuetext={readout(hover)}
      onpointermove={(e) => (hover = nearest(e.clientX, e.currentTarget))}
      onpointerleave={() => (hover = null)}
      onblur={() => (hover = null)}
      onkeydown={key}
      onclick={(e) => {
        const k = nearest(e.clientX, e.currentTarget);
        if (k !== null) onSeek(times[k]!);
      }}
    >
      {#each met as [a, b] (a)}
        <rect class="met" x={x(a)} y={0} width={Math.max(2, x(b) - x(a))} height={plotHeight} fill={ALERT_COLORS.now} />
      {/each}
      {#each days as d (d)}
        <line class="grid" x1={x(d)} x2={x(d)} y1={0} y2={plotHeight + 4} />
        <text class="tick" x={x(d) + 3} y={plotHeight + AXIS - 4}>{formatDay(d)}</text>
      {/each}
      {#each series as s (s.i)}
        <line class="base" x1={PAD} x2={width - PAD} y1={s.top + ROW} y2={s.top + ROW} />
        <line class="threshold" x1={PAD} x2={width - PAD} y1={s.thresholdY} y2={s.thresholdY} />
        <text class="name" x={PAD} y={s.top - 5}>{s.c.name}<tspan class="stat">{"\u00a0· "}{s.c.statistic}</tspan></text>
        <text class="limit" x={width - PAD - 2} y={s.thresholdY < s.top + ROW / 2 ? s.thresholdY + 12 : s.thresholdY - 4} text-anchor="end">{OPS[s.c.operator]} {s.c.threshold} {s.c.units}</text>
        {#if s.empty}
          <text class="none" x={width / 2} y={s.top + ROW / 2 + 8} text-anchor="middle">No values here (a sea variable over land?)</text>
        {:else}
          <path d={s.d} />
        {/if}
      {/each}
      {#if time >= t0 && time <= t1}
        <line class="now" x1={x(time)} x2={x(time)} y1={0} y2={plotHeight} />
      {/if}
      {#if hover !== null}
        <line class="cursor" x1={x(times[hover]!)} x2={x(times[hover]!)} y1={0} y2={plotHeight} />
        {#each series as s (s.i)}
          {#if s.values[hover] !== null}
            <circle cx={x(times[hover]!)} cy={s.y(s.values[hover]!)} r="4" />
          {/if}
        {/each}
      {/if}
    </svg>
    {#if hover !== null}
      <div class="tip num" style:left="{Math.min(Math.max(x(times[hover]!), 70), width - 70)}px">
        <b>{formatTime(times[hover]!)}</b>
        {#each series as s (s.i)}
          <span>{s.c.name}: {formatValue(s.values[hover], s.decimals)} {s.c.units}</span>
        {/each}
        {#if rows[hover]!.coverage_percent !== null}<span>{rows[hover]!.coverage_percent}% of the area</span>{/if}
        {#if rows[hover]!.met}<span class="hit">Conditions met</span>{/if}
      </div>
    {/if}
    <div class="legend">
      <span><i class="swatch" style:background={ALERT_COLORS.now}></i>Conditions met</span>
      <span><i class="dash"></i>Threshold</span>
      <span><i class="tick-now"></i>Map time</span>
      <span class="hint">Click to show that time</span>
    </div>
  {:else}
    <p class="muted">No steps to show.</p>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    user-select: none;
  }
  svg {
    display: block;
    cursor: pointer;
    overflow: visible;
    border-radius: 4px;
  }
  svg:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .met {
    opacity: 0.16;
  }
  .grid {
    stroke: var(--grid);
  }
  .base {
    stroke: var(--axis);
  }
  .threshold {
    stroke: var(--text-2);
    stroke-dasharray: 4 3;
    opacity: 0.7;
  }
  path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  text {
    font-size: 11px;
    fill: var(--text-2);
  }
  .name {
    fill: var(--text);
    font-weight: 600;
  }
  .stat {
    fill: var(--muted);
    font-weight: 400;
  }
  .limit,
  .tick,
  .none {
    fill: var(--muted);
  }
  .now {
    stroke: var(--text-2);
    stroke-width: 1.5;
  }
  .cursor {
    stroke: var(--text);
    opacity: 0.5;
  }
  circle {
    fill: var(--accent);
    stroke: var(--panel-solid);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: -6px;
    transform: translate(-50%, -100%);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    border-radius: 7px;
    background: var(--panel-raised);
    border: 1px solid var(--border);
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 1;
  }
  .tip .hit {
    color: var(--text);
    font-weight: 600;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend .hint {
    margin-left: auto;
  }
  .swatch {
    width: 12px;
    height: 10px;
    border-radius: 2px;
    opacity: 0.45;
  }
  .dash {
    width: 14px;
    border-top: 1.5px dashed var(--text-2);
  }
  .tick-now {
    width: 1.5px;
    height: 10px;
    background: var(--text-2);
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
</style>

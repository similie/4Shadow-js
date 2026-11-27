<script lang="ts" module>
  /** A stretch of time to mark on the track, such as an alert's event. */
  export interface TimelineMark {
    start: number;
    end: number;
    label: string;
    color: string;
    /** Drawn fainter (an alert other than the selected one). */
    dim?: boolean;
  }
</script>

<script lang="ts">
  import { dayKey, formatDay, formatTime, formatUtc } from "#lib/format.ts";

  let {
    steps,
    time,
    initTime,
    observed = false,
    playing,
    loading,
    onSeek,
    onToggle,
    marks = [],
  }: {
    steps: number[];
    time: number;
    initTime: number;
    /** The steps are hours observed (satellite imagery): say how long ago, not how far into the run. */
    observed?: boolean;
    playing: boolean;
    loading: boolean;
    onSeek: (ms: number) => void;
    onToggle: () => void;
    marks?: TimelineMark[];
  } = $props();

  const shown = $derived(marks.filter((m) => m.end >= first && m.start <= last));
  const clamp = (ms: number) => Math.max(first, Math.min(last, ms));

  let track: HTMLDivElement | undefined = $state();
  let dragging = $state(false);
  let hover = $state<number | null>(null);

  const first = $derived(steps[0] ?? 0);
  const last = $derived(steps[steps.length - 1] ?? 0);
  const span = $derived(Math.max(1, last - first));
  const pct = (ms: number) => ((ms - first) / span) * 100;

  /** Local-midnight boundaries inside the run, with labels for each day's segment. */
  const days = $derived.by(() => {
    if (!steps.length) return [];
    const out: Array<{ start: number; end: number; label: string }> = [];
    let start = first;
    let key = dayKey(first);
    for (let t = first; t <= last; t += 3_600_000) {
      const k = dayKey(t);
      if (k !== key) {
        out.push({ start, end: t, label: formatDay(start) });
        start = t;
        key = k;
      }
    }
    out.push({ start, end: last, label: formatDay(start) });
    return out;
  });

  const now = Date.now();
  const leadHours = $derived(Math.round((time - initTime) / 3_600_000));
  const agoHours = $derived(Math.max(0, Math.round((now - time) / 3_600_000)));

  function timeAt(clientX: number): number {
    const r = track!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    // Snap to whole hours: the steps are hourly or 3-hourly.
    return Math.round((first + f * span) / 3_600_000) * 3_600_000;
  }

  function down(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSeek(timeAt(e.clientX));
  }

  function move(e: PointerEvent) {
    hover = timeAt(e.clientX);
    if (dragging) onSeek(hover);
  }

  function keydown(e: KeyboardEvent) {
    const hour = 3_600_000;
    if (e.key === "ArrowRight") onSeek(time + (e.shiftKey ? 24 : 1) * hour);
    else if (e.key === "ArrowLeft") onSeek(time - (e.shiftKey ? 24 : 1) * hour);
    else if (e.key === "Home") onSeek(first);
    else if (e.key === "End") onSeek(last);
    else return;
    e.preventDefault();
  }
</script>

<div class="timeline panel">
  <button class="play" onclick={onToggle} aria-label={playing ? "Pause" : "Play"} title="Play / pause (space)">
    {#if playing}
      <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
    {:else}
      <svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
    {/if}
  </button>

  <div class="when">
    <div class="local num">{steps.length ? formatTime(time) : "–"}</div>
    <div class="sub num">
      {steps.length ? `${formatUtc(time)} · ${observed ? `observed ${agoHours} h ago` : `+${leadHours} h`}` : ""}
      {#if loading}<span class="dot" title="Loading data"></span>{/if}
    </div>
  </div>

  <div
    class="track"
    bind:this={track}
    role="slider"
    tabindex="0"
    aria-label="Forecast time"
    aria-valuemin={first}
    aria-valuemax={last}
    aria-valuenow={time}
    aria-valuetext={formatTime(time)}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (dragging = false)}
    onpointerleave={() => (hover = null)}
    onkeydown={keydown}
  >
    <div class="days">
      {#each days as d, i (d.start)}
        <div class="day" class:alt={i % 2 === 1} style:left="{pct(d.start)}%" style:width="{pct(d.end) - pct(d.start)}%">
          <span>{d.label}</span>
        </div>
      {/each}
    </div>
    {#each shown as m, i (i)}
      <div
        class="mark"
        class:dim={m.dim}
        style:left="{pct(clamp(m.start))}%"
        style:width="max(3px, {pct(clamp(m.end)) - pct(clamp(m.start))}%)"
        style:background={m.color}
        title="{m.label}: {formatTime(m.start)} to {formatTime(m.end)}"
      ></div>
    {/each}
    <div class="bar">
      <div class="fill" style:width="{pct(time)}%"></div>
      {#if now >= first && now <= last}
        <div class="now" style:left="{pct(now)}%" title="Now"></div>
      {/if}
      <div class="thumb" style:left="{pct(time)}%"></div>
    </div>
    {#if hover !== null && !dragging}
      <div class="hover num" style:left="{pct(hover)}%">{formatTime(hover)}</div>
    {/if}
  </div>
</div>

<style>
  .timeline {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px 8px 8px;
  }
  .play {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
    display: grid;
    place-items: center;
  }
  .play svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .when {
    flex: none;
    width: 150px;
  }
  .local {
    font-weight: 600;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.2;
    }
  }
  .track {
    position: relative;
    flex: 1;
    height: 40px;
    cursor: pointer;
    touch-action: none;
    outline-offset: 4px;
  }
  .days {
    position: absolute;
    inset: 0 0 14px 0;
  }
  .day {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--axis);
    font-size: 11px;
    color: var(--text-2);
    padding: 2px 0 0 6px;
    overflow: hidden;
    white-space: nowrap;
  }
  .day.alt {
    background: rgba(255, 255, 255, 0.025);
  }
  .mark {
    position: absolute;
    bottom: 12px;
    height: 5px;
    border-radius: 2px;
    opacity: 0.9;
  }
  .mark.dim {
    opacity: 0.35;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 5px;
    height: 4px;
    border-radius: 2px;
    background: var(--grid);
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    background: rgba(127, 209, 255, 0.45);
  }
  .now {
    position: absolute;
    top: -5px;
    width: 2px;
    height: 14px;
    margin-left: -1px;
    background: var(--text-2);
    border-radius: 1px;
  }
  .thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px rgba(127, 209, 255, 0.25);
  }
  .hover {
    position: absolute;
    bottom: 44px;
    transform: translateX(-50%);
    padding: 3px 7px;
    border-radius: 6px;
    background: var(--panel-raised);
    border: 1px solid var(--border);
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
  }
</style>

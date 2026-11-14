<script lang="ts">
  import type { Forecast } from "@similie/4shadow";
  import { compass } from "@similie/4shadow";
  import { dayKey, formatDay, formatTime } from "#lib/format.ts";

  let { forecast, time, onPick }: { forecast: Forecast; time: number; onPick: (ms: number) => void } = $props();

  let width = $state(380);
  let hoverIndex = $state<number | null>(null);

  const tz = $derived(forecast.timezone.name);
  const ts = $derived(forecast.timeseries);
  const times = $derived(ts.time.map((t) => Date.parse(t)));
  const num = (k: string) => ((ts[k] as Array<number | null> | undefined) ?? []).map((v) => (v === null ? NaN : v));
  const temp = $derived(num("t2m"));
  const rain = $derived(num("precip"));
  const wind = $derived(num("wind_speed"));
  const gust = $derived(num("gust"));
  const dir = $derived(num("wind_dir"));
  const wave = $derived(num("wave_height"));
  const waveDir = $derived(num("wave_dir"));
  const wavePeriod = $derived(num("wave_period"));
  const swell = $derived(num("swell_height"));
  /** Sea state is shown only where there is sea (it is null over land). */
  const hasWaves = $derived(wave.some(Number.isFinite));

  const M = { left: 34, right: 10 };
  const ROWS = { temp: [18, 92], rain: [124, 176], wind: [208, 280], waves: [322, 380] } as const;
  const axis = $derived(hasWaves ? 384 : 284);
  const height = $derived(axis + 22);

  const t0 = $derived(times[0] ?? 0);
  const t1 = $derived(times[times.length - 1] ?? 1);
  const x = (ms: number) => M.left + ((ms - t0) / Math.max(1, t1 - t0)) * (width - M.left - M.right);

  function extent(...series: number[][]): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const v of s) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    return Number.isFinite(lo) ? [lo, hi] : [0, 1];
  }

  /** About `count` round tick values covering lo..hi. */
  function ticks(lo: number, hi: number, count = 3): number[] {
    const span = Math.max(hi - lo, 1e-6);
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
    const out: number[] = [];
    const end = Math.ceil(hi / step - 1e-9) * step;
    for (let v = Math.floor(lo / step + 1e-9) * step; v <= end + step * 1e-6; v += step) out.push(+v.toFixed(6));
    return out.length > 1 ? out : [out[0] ?? 0, (out[0] ?? 0) + step];
  }

  function scale(domain: [number, number], [top, bottom]: readonly [number, number]) {
    const [lo, hi] = domain;
    return (v: number) => bottom - ((v - lo) / Math.max(1e-6, hi - lo)) * (bottom - top);
  }

  function path(values: number[], y: (v: number) => number): string {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(times[i]!).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  const tempTicks = $derived.by(() => {
    const [lo, hi] = extent(temp);
    return ticks(lo, hi);
  });
  const tempY = $derived(scale([tempTicks[0]!, tempTicks[tempTicks.length - 1]!], ROWS.temp));
  const rainMax = $derived(Math.max(1, extent(rain)[1]));
  const rainTicks = $derived(ticks(0, rainMax, 2));
  const rainY = $derived(scale([0, rainTicks[rainTicks.length - 1]!], ROWS.rain));
  const windTicks = $derived(ticks(0, Math.max(5, extent(wind, gust)[1]), 3));
  const windY = $derived(scale([0, windTicks[windTicks.length - 1]!], ROWS.wind));
  const waveTicks = $derived(ticks(0, Math.max(1, extent(wave)[1]), 2));
  const waveY = $derived(scale([0, waveTicks[waveTicks.length - 1]!], ROWS.waves));
  /** Steps to draw a direction arrow at: at least 22 px apart. */
  const arrowSteps = $derived.by(() => {
    const out: number[] = [];
    let last = -Infinity;
    times.forEach((t, i) => {
      if (Number.isFinite(waveDir[i]!) && x(t) - last >= 22) {
        out.push(i);
        last = x(t);
      }
    });
    return out;
  });

  const stepWidth = $derived(times.length > 1 ? x(times[1]!) - x(times[0]!) : 8);
  const barWidth = $derived(Math.max(1, stepWidth - 2));

  /** Local-day boundaries (location's time zone). */
  const days = $derived.by(() => {
    const out: Array<{ at: number; label: string }> = [];
    let prev = "";
    for (const t of times) {
      const k = dayKey(t, tz);
      if (k !== prev) {
        out.push({ at: t, label: formatDay(t, tz) });
        prev = k;
      }
    }
    return out;
  });

  function nearest(clientX: number, svg: SVGSVGElement): number {
    const r = svg.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    let bestD = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(x(t) - px);
      if (d < bestD) (bestD = d), (best = i);
    });
    return best;
  }

  function keydown(e: KeyboardEvent) {
    if (!times.length) return;
    const i = hoverIndex ?? 0;
    if (e.key === "ArrowRight") hoverIndex = Math.min(times.length - 1, i + 1);
    else if (e.key === "ArrowLeft") hoverIndex = Math.max(0, i - 1);
    else if (e.key === "Enter" && hoverIndex !== null) onPick(times[hoverIndex]!);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");
  const tipLeft = $derived(hoverIndex === null ? 0 : Math.min(width - 170, Math.max(0, x(times[hoverIndex]!) + 10)));
</script>

<div class="meteogram" bind:clientWidth={width}>
  <svg
    width={width}
    {height}
    role="slider"
    aria-label="Hourly temperature, rain, wind{hasWaves ? ' and waves' : ''}. Arrow keys move through hours, Enter shows the hour on the map."
    aria-valuemin={0}
    aria-valuemax={Math.max(0, times.length - 1)}
    aria-valuenow={hoverIndex ?? 0}
    aria-valuetext={hoverIndex !== null && times[hoverIndex] ? formatTime(times[hoverIndex]!, tz) : "No hour selected"}
    tabindex="0"
    onpointermove={(e) => (hoverIndex = nearest(e.clientX, e.currentTarget))}
    onpointerleave={() => (hoverIndex = null)}
    onclick={(e) => onPick(times[nearest(e.clientX, e.currentTarget)]!)}
    onkeydown={keydown}
    onblur={() => (hoverIndex = null)}
  >
    <!-- day bands -->
    {#each days as d, i (d.at)}
      <line class="dayline" x1={x(d.at)} x2={x(d.at)} y1={ROWS.temp[0] - 14} y2={axis} />
      <text class="daylabel" x={x(d.at) + 4} y={height - 6}>{i === 0 && x(days[1]?.at ?? t1) - x(d.at) < 40 ? "" : d.label}</text>
    {/each}

    <!-- temperature -->
    <text class="rowlabel" x={M.left} y={ROWS.temp[0] - 6}>Temperature <tspan class="unit">°C</tspan></text>
    {#each tempTicks as v (v)}
      <line class="grid" x1={M.left} x2={width - M.right} y1={tempY(v)} y2={tempY(v)} />
      <text class="tick" x={M.left - 6} y={tempY(v) + 3.5}>{v}</text>
    {/each}
    <path d={path(temp, tempY)} class="line" stroke="var(--series-temp)" />

    <!-- rain -->
    <text class="rowlabel" x={M.left} y={ROWS.rain[0] - 6}>Rain <tspan class="unit">mm/h</tspan></text>
    {#each rainTicks as v (v)}
      <line class="grid" x1={M.left} x2={width - M.right} y1={rainY(v)} y2={rainY(v)} />
      <text class="tick" x={M.left - 6} y={rainY(v) + 3.5}>{v}</text>
    {/each}
    {#each rain as v, i (i)}
      {#if Number.isFinite(v) && v > 0.01}
        {@const top = rainY(v)}
        <rect
          class="bar"
          x={x(times[i]!) - barWidth}
          y={top}
          width={barWidth}
          height={Math.max(1, ROWS.rain[1] - top)}
          rx={Math.min(2, barWidth / 2)}
          fill="var(--series-rain)"
        />
      {/if}
    {/each}

    <!-- wind and gusts -->
    <text class="rowlabel" x={M.left} y={ROWS.wind[0] - 6}>Wind <tspan class="unit">m/s</tspan></text>
    <g class="keys" transform="translate({width - M.right - 104}, {ROWS.wind[0] - 10})">
      <line x1="0" x2="12" y1="0" y2="0" stroke="var(--series-wind)" />
      <text x="16" y="3.5">wind</text>
      <line x1="54" x2="66" y1="0" y2="0" stroke="var(--series-gust)" />
      <text x="70" y="3.5">gusts</text>
    </g>
    {#each windTicks as v (v)}
      <line class="grid" x1={M.left} x2={width - M.right} y1={windY(v)} y2={windY(v)} />
      <text class="tick" x={M.left - 6} y={windY(v) + 3.5}>{v}</text>
    {/each}
    <path d={path(gust, windY)} class="line" stroke="var(--series-gust)" />
    <path d={path(wind, windY)} class="line" stroke="var(--series-wind)" />

    {#if hasWaves}
      <!-- sea state: significant wave height, arrows pointing where the waves travel -->
      <text class="rowlabel" x={M.left} y={ROWS.waves[0] - 18}>Waves <tspan class="unit">m · arrows: heading</tspan></text>
      {#each waveTicks as v (v)}
        <line class="grid" x1={M.left} x2={width - M.right} y1={waveY(v)} y2={waveY(v)} />
        <text class="tick" x={M.left - 6} y={waveY(v) + 3.5}>{v}</text>
      {/each}
      {#each arrowSteps as i (i)}
        <path class="arrow" d="M0,-4.5 V4.5 M-3,1.5 L0,4.5 L3,1.5" transform="translate({x(times[i]!)}, {ROWS.waves[0] - 7}) rotate({waveDir[i]})" />
      {/each}
      <path d={path(wave, waveY)} class="line" stroke="var(--series-wave)" />
    {/if}

    <line class="axis" x1={M.left} x2={width - M.right} y1={axis} y2={axis} />

    <!-- map time -->
    {#if time >= t0 && time <= t1}
      <line class="maptime" x1={x(time)} x2={x(time)} y1={ROWS.temp[0] - 14} y2={axis} />
    {/if}

    <!-- crosshair -->
    {#if hoverIndex !== null}
      {@const hx = x(times[hoverIndex]!)}
      <line class="cross" x1={hx} x2={hx} y1={ROWS.temp[0] - 14} y2={axis} />
      {#if Number.isFinite(temp[hoverIndex]!)}<circle cx={hx} cy={tempY(temp[hoverIndex]!)} r="4" fill="var(--series-temp)" class="ring" />{/if}
      {#if Number.isFinite(wind[hoverIndex]!)}<circle cx={hx} cy={windY(wind[hoverIndex]!)} r="4" fill="var(--series-wind)" class="ring" />{/if}
      {#if Number.isFinite(gust[hoverIndex]!)}<circle cx={hx} cy={windY(gust[hoverIndex]!)} r="4" fill="var(--series-gust)" class="ring" />{/if}
      {#if hasWaves && Number.isFinite(wave[hoverIndex]!)}<circle cx={hx} cy={waveY(wave[hoverIndex]!)} r="4" fill="var(--series-wave)" class="ring" />{/if}
    {/if}
  </svg>

  {#if hoverIndex !== null}
    {@const i = hoverIndex}
    <div class="tip" style:left="{tipLeft}px">
      <div class="tiptime">{formatTime(times[i]!, tz)}</div>
      <div class="row"><i style:background="var(--series-temp)"></i><b class="num">{fmt(temp[i]!)} °C</b><span>temperature</span></div>
      <div class="row"><i style:background="var(--series-rain)"></i><b class="num">{fmt(rain[i]!)} mm/h</b><span>rain</span></div>
      <div class="row">
        <i style:background="var(--series-wind)"></i><b class="num">{fmt(wind[i]!)} m/s</b><span>wind {Number.isFinite(dir[i]!) ? compass(dir[i]!) : ""}</span>
      </div>
      <div class="row"><i style:background="var(--series-gust)"></i><b class="num">{fmt(gust[i]!)} m/s</b><span>gusts</span></div>
      {#if hasWaves}
        <div class="row">
          <i style:background="var(--series-wave)"></i><b class="num">{fmt(wave[i]!)} m</b><span
            >waves{Number.isFinite(waveDir[i]!) ? ` from ${compass(waveDir[i]!)}` : ""}{Number.isFinite(wavePeriod[i]!) ? `, ${fmt(wavePeriod[i]!, 0)} s` : ""}</span
          >
        </div>
        {#if swell[i]! >= 0.1}<div class="row sub"><b class="num">{fmt(swell[i]!)} m</b><span>of it swell</span></div>{/if}
      {/if}
      <div class="hint">Click to show this hour on the map</div>
    </div>
  {/if}
</div>

<style>
  .meteogram {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    cursor: crosshair;
    user-select: none;
  }
  .grid {
    stroke: var(--grid);
    stroke-width: 1;
  }
  .axis {
    stroke: var(--axis);
    stroke-width: 1;
  }
  .arrow {
    fill: none;
    stroke: var(--text-2);
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dayline {
    stroke: var(--axis);
    stroke-width: 1;
  }
  .daylabel {
    font-size: 11px;
    fill: var(--text-2);
  }
  .tick {
    font-size: 10px;
    fill: var(--muted);
    text-anchor: end;
    font-variant-numeric: tabular-nums;
  }
  .rowlabel {
    font-size: 11px;
    fill: var(--text-2);
    font-weight: 500;
  }
  .unit {
    fill: var(--muted);
    font-weight: 400;
  }
  .keys line {
    stroke-width: 2;
    stroke-linecap: round;
  }
  .keys text {
    font-size: 10px;
    fill: var(--muted);
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .maptime {
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .cross {
    stroke: var(--text-2);
    stroke-width: 1;
    opacity: 0.6;
  }
  .ring {
    stroke: var(--panel-solid);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 6px;
    width: 170px;
    padding: 7px 9px;
    border-radius: 8px;
    background: var(--panel-raised);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    font-size: 12px;
    pointer-events: none;
  }
  .tiptime {
    color: var(--text-2);
    margin-bottom: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row i {
    flex: none;
    width: 10px;
    height: 2px;
    border-radius: 1px;
  }
  .row b {
    font-weight: 600;
  }
  .row span {
    color: var(--muted);
  }
  .row.sub {
    padding-left: 16px;
  }
  .hint {
    margin-top: 4px;
    font-size: 11px;
    color: var(--muted);
  }
</style>

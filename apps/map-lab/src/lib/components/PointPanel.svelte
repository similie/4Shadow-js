<script lang="ts">
  import CloseButton from "#lib/components/CloseButton.svelte";
  import { compass, dailyRows, type Forecast, type Place } from "@similie/4shadow";
  import { client } from "#lib/config.ts";
  import { formatCoords, formatTime } from "#lib/format.ts";
  import Meteogram from "./Meteogram.svelte";

  let {
    lat,
    lon,
    place,
    run,
    time,
    onClose,
    onPick,
  }: {
    lat: number;
    lon: number;
    place?: Place;
    run?: string;
    time: number;
    onClose: () => void;
    onPick: (ms: number) => void;
  } = $props();

  let forecast = $state.raw<Forecast | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let showTable = $state(false);

  $effect(() => {
    const ctrl = new AbortController();
    loading = true;
    error = null;
    client
      .forecast({ lat, lon }, { run, signal: ctrl.signal })
      .then((f) => (forecast = f))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") error = (e as Error).message;
      })
      .finally(() => (loading = false));
    return () => ctrl.abort();
  });

  const near = $derived(forecast?.location.nearest_place);
  const title = $derived(place?.display_name ?? (near ? near.display_name : formatCoords(lat, lon)));
  const subtitle = $derived.by(() => {
    const parts = [formatCoords(lat, lon)];
    if (!place && near && near.distance_km !== undefined && near.distance_km > 1) parts.push(`${near.distance_km.toFixed(0)} km from ${near.name}`);
    const el = forecast?.location.model_elevation_m;
    if (el !== null && el !== undefined) parts.push(`model ground ${Math.round(el)} m`);
    return parts.join(" · ");
  });
  const days = $derived(forecast ? dailyRows(forecast) : []);
  const seaPoint = $derived(forecast?.location.sea_point);
  const dailyWaves = $derived(days.some((d) => typeof d.wave_height_max === "number"));
  const cur = $derived(forecast?.current ?? null);
  const v = (k: string, d = 1) => {
    const x = cur?.[k];
    return typeof x === "number" ? x.toFixed(d) : "–";
  };
  const n = (x: unknown, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(d) : "–");
  const dayName = (date: string) =>
    new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(`${date}T12:00Z`));
</script>

<aside class="point panel">
  <header>
    <div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
    <CloseButton onclick={onClose} />
  </header>

  {#if error}
    <p class="error">{error}</p>
  {:else if !forecast}
    <p class="muted">Loading forecast…</p>
  {:else}
    <div class="now" class:stale={loading}>
      <div class="big">{v("t2m")}<span>°C</span></div>
      <dl>
        <div>
          <dt>Wind</dt>
          <dd class="num">{v("wind_speed")} m/s {typeof cur?.wind_dir === "number" ? compass(cur.wind_dir) : ""}</dd>
        </div>
        <div>
          <dt>Gusts</dt>
          <dd class="num">{v("gust")} m/s</dd>
        </div>
        <div>
          <dt>Rain</dt>
          <dd class="num">{v("precip")} mm/h</dd>
        </div>
        <div>
          <dt>Cloud</dt>
          <dd class="num">{v("tcc", 0)} %</dd>
        </div>
        <div>
          <dt>Humidity</dt>
          <dd class="num">{v("rh2m", 0)} %</dd>
        </div>
        <div>
          <dt>Pressure</dt>
          <dd class="num">{v("mslp", 0)} hPa</dd>
        </div>
        {#if typeof cur?.wave_height === "number"}
          <div class="wide">
            <dt>Waves</dt>
            <dd class="num">
              {v("wave_height")} m{typeof cur.wave_dir === "number" ? ` from ${compass(cur.wave_dir)}` : ""}{typeof cur.wave_period === "number"
                ? `, ${v("wave_period", 0)} s`
                : ""}{typeof cur.swell_height === "number" && cur.swell_height >= 0.1 ? ` · swell ${v("swell_height")} m` : ""}
            </dd>
          </div>
        {/if}
      </dl>
      {#if seaPoint && typeof cur?.wave_height === "number"}
        <p class="muted small">
          Sea state from the nearest open sea, {seaPoint.distance_km.toFixed(0)} km away; near the shore it is usually calmer.
        </p>
      {/if}
      <p class="muted small">
        Now in {forecast.timezone.name} · GFS run {forecast.run.slice(0, 8)}
        {forecast.run.slice(8)}Z
      </p>
    </div>

    <Meteogram {forecast} {time} {onPick} />

    {#if days.length}
      <table class="daily num">
        <thead>
          <tr
            ><th>Day</th><th>Low</th><th>High</th><th>Rain</th><th>Wind max</th><th>Gust max</th>{#if dailyWaves}<th>Waves max</th>{/if}</tr
          >
        </thead>
        <tbody>
          {#each days as d (d.date)}
            <tr class:partial={d.hoursCovered < 23} title={d.hoursCovered < 23 ? `Covers ${d.hoursCovered} h of this day` : ""}>
              <td>{dayName(d.date)}</td>
              <td>{n(d.t2m_min, 1)}°</td>
              <td>{n(d.t2m_max, 1)}°</td>
              <td>{n(d.precip_sum, 1)} mm</td>
              <td>{n(d.wind_speed_max, 1)}</td>
              <td>{n(d.gust_max, 1)}</td>
              {#if dailyWaves}<td>{n(d.wave_height_max, 1)} m</td>{/if}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <button class="link" onclick={() => (showTable = !showTable)}>{showTable ? "Hide" : "Show"} hourly table</button>
    {#if showTable}
      <div class="hourly">
        <table class="num">
          <thead><tr><th>Time</th><th>°C</th><th>mm/h</th><th>m/s</th><th>gust</th><th>cloud</th></tr></thead>
          <tbody>
            {#each forecast.timeseries.time as t, i (t)}
              <tr>
                <td>{formatTime(Date.parse(t), forecast.timezone.name)}</td>
                <td>{n(forecast.timeseries.t2m?.[i], 1)}</td>
                <td>{n(forecast.timeseries.precip?.[i], 1)}</td>
                <td>{n(forecast.timeseries.wind_speed?.[i], 1)}</td>
                <td>{n(forecast.timeseries.gust?.[i], 1)}</td>
                <td>{n(forecast.timeseries.tcc?.[i])}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</aside>

<style>
  .point {
    width: 420px;
    max-height: calc(100vh - 150px);
    overflow-y: auto;
    padding: 14px 16px 16px;
    background: rgba(20, 24, 30, 0.96);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  header p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .now {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 18px;
    align-items: center;
    margin-bottom: 8px;
    transition: opacity 0.2s;
  }
  .now.stale {
    opacity: 0.6;
  }
  .big {
    font-size: 40px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .big span {
    font-size: 18px;
    color: var(--text-2);
    margin-left: 2px;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 14px;
    margin: 0;
    font-size: 12px;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  dl div.wide {
    grid-column: 1 / -1;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .small {
    grid-column: 1 / -1;
    font-size: 11px;
    margin: 2px 0 0;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--danger);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .daily {
    margin-top: 10px;
  }
  th {
    text-align: right;
    font-weight: 500;
    color: var(--muted);
    padding: 4px 4px;
    border-bottom: 1px solid var(--axis);
  }
  td {
    text-align: right;
    padding: 4px 4px;
    border-bottom: 1px solid var(--grid);
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  tr.partial td {
    color: var(--muted);
  }
  .link {
    margin-top: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }
  .hourly {
    max-height: 260px;
    overflow-y: auto;
    margin-top: 6px;
  }
</style>

<script lang="ts">
  import type { Place, RunDetail, RunSummary, VariableInfo } from "@similie/4shadow";
  import * as maplibregl from "maplibre-gl";
  import { onMount } from "svelte";
  import Legend from "#lib/components/Legend.svelte";
  import PointPanel from "#lib/components/PointPanel.svelte";
  import Search from "#lib/components/Search.svelte";
  import Timeline from "#lib/components/Timeline.svelte";
  import { API_URL, client } from "#lib/config.ts";
  import { formatCoords, formatValue, formatWave, formatWind } from "#lib/format.ts";
  import { COLOR_LAYERS } from "#lib/weather/catalog.ts";
  import { WeatherMap, type Readout, type Status } from "#lib/weather/weather-map.ts";

  let container: HTMLDivElement;
  let wm = $state.raw<WeatherMap | null>(null);
  let marker: maplibregl.Marker | null = null;

  let layerId: string | null = $state("wind");
  let particles = $state(true);
  let isobarsOn = $state(true);
  let compare = $state(false);
  let globe = $state(false);
  // The global grid. Zoomed in, the area in view is fetched at 0.25° on top of it.
  let stride = $state(2);
  let opacity = $state(0.85);
  let speed = $state(3);
  let settingsOpen = $state(false);

  let run = $state.raw<RunDetail | null>(null);
  let runs: RunSummary[] = $state.raw([]);
  let variables: VariableInfo[] = $state.raw([]);
  let steps: number[] = $state.raw([]);
  let time = $state(0);
  let playing = $state(false);
  let status: Status = $state({ loading: 0, error: null });
  let readout = $state<Readout | null>(null);
  let point: { lat: number; lon: number; place?: Place } | null = $state(null);
  let fatal = $state<string | null>(null);

  const layer = $derived(COLOR_LAYERS.find((l) => l.id === layerId) ?? null);
  const legendInfo = $derived(layer ? variables.find((v) => v.id === layer.legendVar) : undefined);
  const initTime = $derived(run ? Date.parse(run.init_time) : 0);

  onMount(() => {
    const w = new WeatherMap({ container, client, stride });
    w.onStatus = (s) => (status = s);
    w.onTime = (ms) => (time = ms);
    w.map.on("mousemove", (e) => (readout = w.readout(e.lngLat.lng, e.lngLat.lat)));
    w.map.on("mouseout", () => (readout = null));
    w.map.on("click", (e) => openPoint({ lat: e.lngLat.lat, lon: e.lngLat.wrap().lng }));
    wm = w;
    if (import.meta.env.DEV) (window as unknown as { weatherMap: WeatherMap }).weatherMap = w; // for poking at in devtools
    load(w);
    return () => w.destroy();
  });

  async function load(w: WeatherMap) {
    try {
      const [vars, list] = await Promise.all([client.variables(), client.runs()]);
      variables = vars.variables;
      w.setCatalog(vars.variables);
      runs = list.runs;
      if (!list.latest) throw new Error("The API has no forecast runs yet");
      await selectRun(list.latest);
    } catch (e) {
      fatal = `Could not reach the forecast API at ${API_URL}: ${(e as Error).message}`;
    }
  }

  async function selectRun(id: string) {
    const r = await client.run(id);
    run = r;
    steps = r.valid_times.map((t) => Date.parse(t));
    wm?.setRun(r);
    time = wm?.currentTime ?? steps[0] ?? 0;
  }

  // Push UI settings into the map.
  $effect(() => wm?.setLayer(layerId));
  $effect(() => wm?.setParticles(particles));
  $effect(() => wm?.setIsobars(isobarsOn));
  $effect(() => wm?.setCompare(compare));
  $effect(() => wm?.setStride(stride));
  $effect(() => wm?.setOpacity(opacity));
  $effect(() => wm?.setProjection(globe ? "globe" : "mercator"));

  function seek(ms: number) {
    wm?.setTime(ms);
    time = wm?.currentTime ?? ms;
  }

  function togglePlay() {
    if (!wm) return;
    if (wm.isPlaying) wm.pause();
    else wm.play(speed);
    playing = wm.isPlaying;
  }

  $effect(() => {
    if (playing && wm) {
      wm.pause();
      wm.play(speed);
    }
  });

  function openPoint(p: { lat: number; lon: number; place?: Place }) {
    point = p;
    marker?.remove();
    const el = document.createElement("div");
    el.className = "pin";
    marker = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(wm!.map);
  }

  function closePoint() {
    point = null;
    marker?.remove();
    marker = null;
  }

  function picked(p: { lat: number; lon: number; place?: Place }) {
    const zoom = p.place?.area ? 4 : 7;
    wm?.map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(wm.map.getZoom(), zoom), speed: 1.6 });
    openPoint(p);
  }

  function keydown(e: KeyboardEvent) {
    if (e.target instanceof Element && e.target.closest("input, select, textarea, [role=slider]")) return;
    if (e.key === " ") {
      togglePlay();
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      seek(time + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 24 : 1) * 3_600_000);
    } else if (e.key === "Escape") {
      closePoint();
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="map" bind:this={container}></div>

<div class="top-left">
  <div class="brand">
    <svg viewBox="0 0 32 32" aria-hidden="true"
      ><path d="M5 13c4-3 8-3 12 0s8 3 10 0M5 19c4-3 8-3 12 0s8 3 10 0" stroke="#7fd1ff" stroke-width="2.6" fill="none" stroke-linecap="round" /></svg
    >
    <span>4Shadow <em>map lab</em></span>
  </div>
  <Search onPick={picked} />
  {#if point}
    <PointPanel
      lat={point.lat}
      lon={point.lon}
      place={point.place}
      run={run?.run}
      {time}
      onClose={closePoint}
      onPick={seek}
    />
  {/if}
</div>

<nav class="layers panel" aria-label="Weather layers">
  {#each COLOR_LAYERS as l (l.id)}
    <button class:active={layerId === l.id} onclick={() => (layerId = layerId === l.id ? null : l.id)} aria-pressed={layerId === l.id}>
      <span class="icon" aria-hidden="true">{l.icon}</span>{l.label}
    </button>
  {/each}
  <hr />
  <label class="toggle" title={layer?.flow ? "Particles travel with the waves, at their group speed" : "Particles travel with the 10 m wind"}
    ><input type="checkbox" bind:checked={particles} /> {layer?.flow ? "Wave" : "Wind"} particles</label
  >
  <label class="toggle"><input type="checkbox" bind:checked={isobarsOn} /> Isobars</label>
  <label class="toggle"><input type="checkbox" bind:checked={globe} /> Globe</label>
  <button class="more" onclick={() => (settingsOpen = !settingsOpen)} aria-expanded={settingsOpen}>
    {settingsOpen ? "Fewer" : "More"} settings
  </button>
  {#if settingsOpen}
    <div class="settings">
      <label class="toggle" title="Show the server's PNG tiles for this layer instead, to compare"
        ><input type="checkbox" bind:checked={compare} /> Server tiles</label
      >
      <label title="Grid of the whole-world data. Zoomed in, the area in view also loads at 0.25°."
        >Global grid
        <select bind:value={stride}>
          <option value={1}>0.25° (full)</option>
          <option value={2}>0.5° + detail</option>
          <option value={4}>1° + detail</option>
        </select>
      </label>
      <label>Opacity <input type="range" min="0" max="1" step="0.05" bind:value={opacity} /></label>
      <label
        >Play speed
        <select bind:value={speed}>
          <option value={1}>1 h/s</option>
          <option value={3}>3 h/s</option>
          <option value={6}>6 h/s</option>
          <option value={12}>12 h/s</option>
        </select>
      </label>
      {#if runs.length > 1}
        <label
          >Run
          <select value={run?.run} onchange={(e) => selectRun((e.currentTarget as HTMLSelectElement).value)}>
            {#each runs as r (r.run)}
              <option value={r.run}>{r.run.slice(0, 8)} {r.run.slice(8)}Z · {r.steps} steps</option>
            {/each}
          </select>
        </label>
      {/if}
      <p class="api">API: {API_URL}</p>
    </div>
  {/if}
</nav>

<div class="bottom">
  <div class="info">
    {#if layer && legendInfo?.legend}
      <Legend info={legendInfo} label={layer.label} />
    {/if}
    {#if readout}
      <div class="readout panel num">
        <span class="coords">{formatCoords(readout.lat, readout.lon)}</span>
        {#if layer && legendInfo && layer.id !== "wind"}
          <span><b>{formatValue(readout.value, layer.decimals)}</b> {legendInfo.units}</span>
        {/if}
        {#if readout.wave}<span>{formatWave(readout.wave.direction, readout.wave.period)}</span>{/if}
        {#if readout.wind}<span class:strong={layer?.id === "wind"}>{formatWind(readout.wind.speed, readout.wind.direction)}</span>{/if}
        {#if readout.mslp !== null && isobarsOn && layer?.id !== "mslp"}<span>{readout.mslp.toFixed(0)} hPa</span>{/if}
      </div>
    {/if}
  </div>
  {#if steps.length}
    <Timeline {steps} {time} {initTime} {playing} loading={status.loading > 0} onSeek={seek} onToggle={togglePlay} />
  {/if}
</div>

{#if fatal || status.error}
  <div class="toast panel" role="alert">
    {fatal ?? status.error}
    {#if !fatal}<button onclick={() => (status = { ...status, error: null })} aria-label="Dismiss">×</button>{/if}
  </div>
{/if}

<style>
  .map {
    position: fixed;
    inset: 0;
  }
  .top-left {
    position: fixed;
    top: 12px;
    left: 12px;
    width: 420px;
    max-width: calc(100vw - 24px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  }
  .brand svg {
    width: 24px;
    height: 24px;
  }
  .brand em {
    font-style: normal;
    font-weight: 400;
    color: var(--text-2);
  }
  .layers {
    position: fixed;
    top: 12px;
    right: 12px;
    width: 172px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 2;
  }
  .layers button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: none;
    text-align: left;
    color: var(--text-2);
  }
  .layers button:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
  }
  .layers button.active {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .icon {
    width: 18px;
    text-align: center;
    font-size: 14px;
  }
  hr {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--border);
    margin: 6px 0;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 13px;
    color: var(--text-2);
    cursor: pointer;
  }
  .toggle input {
    accent-color: var(--accent);
  }
  .layers .more {
    font-size: 12px;
    color: var(--accent);
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 8px 6px;
    font-size: 12px;
    color: var(--text-2);
  }
  .settings label {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .settings label.toggle {
    flex-direction: row;
    padding: 0;
  }
  .settings select {
    background: var(--panel-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 4px;
  }
  .settings input[type="range"] {
    accent-color: var(--accent);
  }
  .api {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    word-break: break-all;
  }
  .bottom {
    position: fixed;
    left: 12px;
    right: 58px;
    bottom: 26px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2;
    pointer-events: none;
  }
  .bottom > :global(*) {
    pointer-events: auto;
  }
  .info {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .info > :global(*) {
    pointer-events: auto;
  }
  .readout {
    display: flex;
    gap: 14px;
    padding: 8px 12px;
    font-size: 13px;
  }
  .readout .strong {
    font-weight: 600;
  }
  .readout .coords {
    color: var(--muted);
  }
  .toast {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 560px;
    padding: 10px 14px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    color: var(--danger);
    z-index: 3;
  }
  .toast button {
    border: 0;
    background: none;
    color: var(--text-2);
    font-size: 16px;
    line-height: 1;
  }
  :global(.pin) {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid #0b0e12;
    box-shadow: 0 0 0 2px var(--accent);
  }
  @media (max-width: 720px) {
    .top-left {
      width: calc(100vw - 24px - 150px);
    }
    .layers {
      width: 140px;
    }
    .bottom {
      right: 12px;
    }
  }
</style>

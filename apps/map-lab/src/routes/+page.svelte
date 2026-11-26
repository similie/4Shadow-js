<script lang="ts">
  import type { Alert, AlertArea, Model, Place, RunDetail, RunSummary, VariableInfo, VariablesResponse } from "@similie/4shadow";
  import * as maplibregl from "maplibre-gl";
  import { onMount } from "svelte";
  import { ALERT_COLORS, AlertLayers } from "#lib/alerts/alert-layers.ts";
  import { bounds } from "#lib/alerts/geo.ts";
  import { AlertsStore } from "#lib/alerts/store.svelte.ts";
  import AlertsPanel from "#lib/components/alerts/AlertsPanel.svelte";
  import Legend from "#lib/components/Legend.svelte";
  import PointPanel from "#lib/components/PointPanel.svelte";
  import Search from "#lib/components/Search.svelte";
  import Timeline, { type TimelineMark } from "#lib/components/Timeline.svelte";
  import { API_URL, client, DIRECT } from "#lib/config.ts";
  import { formatCoords, formatCurrent, formatValue, formatWave, formatWind } from "#lib/format.ts";
  import { CURRENT_PACE, layersFor } from "#lib/weather/catalog.ts";
  import { WeatherMap, type Readout, type Status } from "#lib/weather/weather-map.ts";

  let { data } = $props();
  /** A public map (MAP_MODE=public) shows the weather only: early warnings belong to the key's owner. */
  const publicMap = $derived(data.mode === "public");

  let container: HTMLDivElement;
  let wm = $state.raw<WeatherMap | null>(null);
  let marker: maplibregl.Marker | null = null;

  let layerId: string | null = $state("wind");
  let particles = $state(true);
  /** Current particles' speed, as a multiple of the water's. */
  let currentPace = $state(CURRENT_PACE);
  let isobarsOn = $state(true);
  let coastlinesOn = $state(true);
  let compare = $state(false);
  let globe = $state(false);
  /** Day basemap (light land and sea, dark particles); the panels stay as they are. */
  let day = $state(false);
  // The global grid. Zoomed in, the area in view is fetched at 0.25° on top of it.
  let stride = $state(2);
  let opacity = $state(0.85);
  let speed = $state(3);
  let settingsOpen = $state(false);
  /** Height of the bottom stack (legend, readout, timeline): the side panels end above it. */
  let bottomHeight = $state(0);

  /**
   * The weather models to switch between, and models drawn over them (air quality, which has no wind
   * of its own), found from the API's health: those with a run that your key may call.
   */
  let model = $state<Model>("gfs");
  let models = $state.raw<Array<{ id: Model; title: string; description: string }>>([]);
  let overlays = $state.raw<Array<{ run: RunDetail; variables: VariableInfo[]; title: string }>>([]);
  let searched = false;

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

  // Early warnings: your alerts and their events, on the map, the timeline and in their panel.
  const alerts = new AlertsStore();
  let alertLayers = $state.raw<AlertLayers | null>(null);
  let alertsOpen = $state(false);
  let selectedAlert = $state<string | null>(null);
  /** Set while an alert is being drawn or edited: map clicks belong to the editor then. */
  let alertEditing = $state<{ alert: Alert | null } | null>(null);

  // Only the layers this run can draw (AIGFS has no clouds or waves, and a run made before a variable
  // was added lacks it), and those an air-quality run draws over it.
  const layers = $derived(
    run
      ? layersFor(
          variables,
          run.variables,
          overlays.map((o) => ({ catalog: o.variables, stored: o.run.variables })),
        )
      : [],
  );
  const layer = $derived(layers.find((l) => l.id === layerId) ?? null);
  const allVariables = $derived([...variables, ...overlays.flatMap((o) => o.variables)]);
  const legendInfo = $derived(layer ? allVariables.find((v) => v.id === layer.legendVar) : undefined);
  const initTime = $derived(run ? Date.parse(run.init_time) : 0);

  onMount(() => {
    const w = new WeatherMap({ container, client, stride });
    w.onStatus = (s) => (status = s);
    w.onTime = (ms) => (time = ms);
    w.map.on("mousemove", (e) => (readout = w.readout(e.lngLat.lng, e.lngLat.lat)));
    w.map.on("mouseout", () => (readout = null));
    const al = new AlertLayers(w.map);
    w.map.on("click", (e) => {
      if (al.handleClick(e)) return; // a corner of the area being drawn
      const hit = al.hit(e.point);
      if (hit && !alertEditing) return openAlerts(hit);
      if (!alertEditing) openPoint({ lat: e.lngLat.lat, lon: e.lngLat.wrap().lng });
    });
    wm = w;
    alertLayers = al;
    if (import.meta.env.DEV) (window as unknown as { weatherMap: WeatherMap }).weatherMap = w; // for poking at in devtools
    load(w);
    if (data.mode !== "public") alerts.start();
    const unalign = alignBottomBar(container);
    return () => {
      unalign();
      alerts.stop();
      al.destroy();
      w.destroy();
    };
  });

  /**
   * Keep the bottom bar level with the zoom buttons and clear of them, above the attribution (which
   * changes height as it opens, closes and wraps).
   */
  function alignBottomBar(el: HTMLElement): () => void {
    const corner = el.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
    const zoom = corner?.querySelector<HTMLElement>(".maplibregl-ctrl-group");
    if (!corner || !zoom) return () => {};
    const root = document.documentElement.style;
    const update = () => {
      const r = zoom.getBoundingClientRect();
      root.setProperty("--controls-bottom", `${Math.round(window.innerHeight - r.bottom)}px`);
      root.setProperty("--controls-right", `${Math.round(window.innerWidth - r.left + 8)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(corner);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }

  async function load(w: WeatherMap) {
    try {
      const [vars, list] = await Promise.all([client.variables(model), client.runs(model)]);
      variables = vars.variables;
      w.setCatalog(vars.variables);
      runs = list.runs;
      if (!list.latest) throw new Error("The API has no forecast runs yet");
      await selectRun(list.latest);
      if (!searched) {
        searched = true;
        findModels(vars);
      }
    } catch (e) {
      const rig = DIRECT
        ? null
        : await fetch("/api/rig")
            .then((r) => r.json())
            .catch(() => null);
      fatal =
        rig && !rig.keyConfigured
          ? "The lab has no API key. Put FORESHADOW_API_KEY=your-key in apps/map-lab/.env.local and restart it."
          : `Could not reach the forecast API at ${DIRECT ? API_URL : (rig?.apiUrl ?? API_URL)}: ${(e as Error).message}`;
    }
  }

  /**
   * Offer the other models the API has a run of: weather models in the switch, air quality as layers.
   * A model your key's plan doesn't include answers 403, and isn't offered.
   */
  async function findModels(gfs: VariablesResponse) {
    const health = await client.health().catch(() => null);
    const ids = health
      ? Object.entries(health.models)
          .filter(([id, m]) => id !== "gfs" && m.latest_run)
          .map(([id]) => id)
      : ["aigfs"];
    const found = (
      await Promise.all(
        ids.map((id) =>
          Promise.all([client.variables(id), client.runs(id)])
            .then(([v, r]) => (r.latest ? { id, vars: v, latest: r.latest } : null))
            .catch(() => null),
        ),
      )
    ).filter((m) => m !== null);
    // A weather model has wind; one without (air quality) draws its layers over the weather model's.
    const weather = found.filter((m) => m.vars.variables.some((v) => v.id === "u10"));
    const info = (id: string, v: VariablesResponse) => ({ id, title: v.title ?? id.toUpperCase(), description: v.description ?? "" });
    if (weather.length) models = [info("gfs", gfs), ...weather.map((m) => info(m.id, m.vars))];
    const extra = await Promise.all(
      found
        .filter((m) => !weather.includes(m))
        .map((m) =>
          client
            .run(m.latest, m.id)
            .then((run) => ({ run, variables: m.vars.variables, title: m.vars.title ?? m.id }))
            .catch(() => null),
        ),
    );
    overlays = extra.filter((o) => o !== null);
    wm?.setOverlays(overlays);
  }

  async function switchModel(id: Model) {
    if (id === model || !wm) return;
    model = id;
    await load(wm);
  }

  async function selectRun(id: string) {
    const r = await client.run(id, model);
    run = r;
    // Keep the layer if this run has it; otherwise wind, which every run has. Tell the map before
    // giving it the run, so the run is never asked for a variable it lacks.
    if (layerId && !layers.some((l) => l.id === layerId)) {
      layerId = "wind";
      wm?.setLayer(layerId);
    }
    steps = r.valid_times.map((t) => Date.parse(t));
    wm?.setRun(r);
    time = wm?.currentTime ?? steps[0] ?? 0;
  }

  // Push UI settings into the map.
  $effect(() => wm?.setLayer(layerId));
  $effect(() => wm?.setParticles(particles));
  $effect(() => wm?.setCurrentPace(currentPace));
  $effect(() => wm?.setIsobars(isobarsOn));
  $effect(() => wm?.setCoastlines(coastlinesOn));
  $effect(() => wm?.setCompare(compare));
  $effect(() => wm?.setStride(stride));
  $effect(() => wm?.setOpacity(opacity));
  $effect(() => wm?.setProjection(globe ? "globe" : "mercator"));
  $effect(() => wm?.setTheme(day ? "light" : "dark"));

  // Push alerts into the map: areas, events, and which events are on at the map's time (by the hour).
  const hour = $derived(Math.round(time / 3_600_000) * 3_600_000);
  $effect(() => alertLayers?.setAlerts(alerts.alerts, alertsOpen ? selectedAlert : null));
  $effect(() => alertLayers?.setEvents(alerts.events));
  $effect(() => alertLayers?.setTime(hour));

  const eventCount = $derived(alerts.events?.features.length ?? 0);
  const marks = $derived<TimelineMark[]>(
    (alerts.events?.features ?? []).map(({ properties: e }) => ({
      start: Date.parse(e.start),
      end: Date.parse(e.end),
      label: e.alert_name ?? "Alert",
      color: ALERT_COLORS.now,
      dim: alertsOpen && !!selectedAlert && e.alert_id !== selectedAlert,
    })),
  );

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

  function openAlerts(id: string | null = selectedAlert) {
    closePoint();
    selectedAlert = id;
    alertsOpen = true;
  }

  function focusArea(area: AlertArea, radiusKm: number) {
    const [w, s, e, n] = bounds(area, radiusKm);
    const narrow = window.innerWidth < 720;
    wm?.map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: { top: 60, bottom: 150, left: narrow ? 40 : 460, right: narrow ? 40 : 200 }, maxZoom: 8, duration: 900 },
    );
  }

  function openPoint(p: { lat: number; lon: number; place?: Place }) {
    alertsOpen = false;
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
    } else if (e.key === "Escape" && !alertEditing) {
      closePoint();
      alertsOpen = false;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<svelte:head>
  <title>{publicMap ? "Weather map · 4Shadow" : "4Shadow map lab"}</title>
  {#if publicMap}
    <meta
      name="description"
      content="Live global weather: wind, rain, temperature, pressure and waves for the next 16 days, from NOAA GFS through the 4Shadow API."
    />
  {/if}
</svelte:head>

<div class="map" bind:this={container}></div>

<div class="top-left" style:--bottom-stack="{bottomHeight}px">
  <div class="brand">
    <a class="logo" href="https://4shadow.io" target="_blank" rel="noreferrer"
      ><img src="/brand/4shadow-wordmark-dark.svg" alt="4Shadow" /><span class="tag">{publicMap ? "Live map" : "Map lab"}</span></a
    >
    {#if publicMap}
      <a class="warnings" href="https://4shadow.io/signup" target="_blank" rel="noreferrer" title="The data on this map comes from the 4Shadow API"
        >Get a free API key</a
      >
    {:else}
      <button
        class="warnings"
        class:active={alertsOpen}
        aria-pressed={alertsOpen}
        onclick={() => (alertsOpen ? (alertsOpen = false) : openAlerts())}
        title="Alerts on your API key: draw an area, set conditions, get webhooks days ahead"
      >
        Early warnings
        {#if eventCount}<span class="count num" style:background={ALERT_COLORS.now}>{eventCount}</span>{/if}
      </button>
    {/if}
  </div>
  <Search onPick={picked} />
  {#if alertsOpen}
    <AlertsPanel
      store={alerts}
      {variables}
      layers={alertLayers}
      run={run?.run}
      {time}
      bind:selected={selectedAlert}
      bind:editing={alertEditing}
      onSeek={seek}
      onFocus={focusArea}
      onClose={() => (alertsOpen = false)}
    />
  {:else if point}
    <PointPanel lat={point.lat} lon={point.lon} place={point.place} model={run?.model} run={run?.run} {time} onClose={closePoint} onPick={seek} />
  {/if}
</div>

<nav class="layers panel" aria-label="Weather layers">
  {#if models.length > 1}
    <div class="models" role="group" aria-label="Forecast model">
      {#each models as m (m.id)}
        <button
          class:active={model === m.id}
          aria-pressed={model === m.id}
          title={m.description ? `${m.title}: ${m.description}` : m.title}
          onclick={() => switchModel(m.id)}>{m.id.toUpperCase()}</button
        >
      {/each}
    </div>
  {/if}
  {#each layers as l (l.id)}
    <button
      class:active={layerId === l.id}
      title={allVariables.find((v) => v.id === l.legendVar)?.description}
      onclick={() => (layerId = layerId === l.id ? null : l.id)}
      aria-pressed={layerId === l.id}
    >
      <span class="icon" aria-hidden="true">{l.icon}</span>{l.label}
    </button>
  {/each}
  <hr />
  <label
    class="toggle"
    title={layer?.flow
      ? "Particles travel with the waves, at their group speed"
      : layer?.current
        ? `Particles travel with the surface current, tides included, ${currentPace} times faster than the water`
        : `Particles travel with the ${layer?.winds ? "100 m" : "10 m"} wind`}
    ><input type="checkbox" bind:checked={particles} /> {layer?.flow ? "Wave" : layer?.current ? "Current" : "Wind"} particles</label
  >
  {#if layer?.current && particles}
    <label class="pace" title="How many times faster than the water the particles move ({CURRENT_PACE} by default)"
      >Speed <input type="range" min="1" max="30" step="1" bind:value={currentPace} /> <span>{currentPace}×</span></label
    >
  {/if}
  <label class="toggle"><input type="checkbox" bind:checked={isobarsOn} /> Isobars</label>
  <label class="toggle"><input type="checkbox" bind:checked={coastlinesOn} /> Coastlines</label>
  <label class="toggle"><input type="checkbox" bind:checked={globe} /> Globe</label>
  <label class="toggle"><input type="checkbox" bind:checked={day} /> Day map</label>
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
          {#if !publicMap}<option value={1}>0.25° (full)</option>{/if}
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
      <p class="api">
        {#if publicMap}Data: the 4Shadow API, through this site's server{:else}API: {DIRECT
            ? API_URL
            : `${alerts.rig?.apiUrl ?? "…"}, through the lab's server`}{/if}
      </p>
    </div>
  {/if}
</nav>

<div class="bottom" bind:offsetHeight={bottomHeight}>
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
        {#if readout.current}<span class="strong">{formatCurrent(readout.current.speed, readout.current.heading)}</span>{/if}
        {#if readout.wind}<span class:strong={layer?.id === "wind"}>{formatWind(readout.wind.speed, readout.wind.direction)}</span>{/if}
        {#if readout.mslp !== null && isobarsOn && layer?.id !== "mslp"}<span>{readout.mslp.toFixed(0)} hPa</span>{/if}
      </div>
    {/if}
  </div>
  {#if steps.length}
    <Timeline {steps} {time} {initTime} {playing} {marks} loading={status.loading > 0} onSeek={seek} onToggle={togglePlay} />
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
    /* Down to the legend and timeline, not over them. */
    max-height: calc(100vh - 12px - var(--controls-bottom, 44px) - var(--bottom-stack, 0px) - 10px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2;
  }
  .top-left > :global(aside.panel) {
    max-height: none;
    min-height: 0;
    flex: 0 1 auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px 7px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: var(--shadow);
    text-decoration: none;
    text-shadow: none;
  }
  .logo img {
    height: 17px;
    width: auto;
    display: block;
  }
  .tag {
    font:
      500 10px/1 ui-monospace,
      "SF Mono",
      Menlo,
      monospace;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  a.warnings {
    color: inherit;
    text-decoration: none;
  }
  .warnings {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    font-size: 13px;
    font-weight: 500;
    text-shadow: none;
    box-shadow: var(--shadow);
  }
  .warnings.active {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
  }
  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 700;
    color: #1a0806;
    text-align: center;
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
  .models {
    display: flex;
    gap: 2px;
    padding: 2px;
    margin-bottom: 4px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.05);
  }
  .layers .models button {
    flex: 1;
    justify-content: center;
    padding: 4px 0;
    font-size: 12px;
    letter-spacing: 0.04em;
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
  .pace {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 4px 32px;
    font-size: 12px;
    color: var(--text-2);
  }
  .pace input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .pace span {
    width: 3ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
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
    right: var(--controls-right, 58px);
    bottom: var(--controls-bottom, 44px);
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
  }
</style>

<script lang="ts">
  import type { Alert, AlertArea, AlertCondition, AlertOperator, AlertPreview, VariableInfo } from "@similie/4shadow";
  import { onDestroy, onMount, untrack } from "svelte";
  import type { AlertLayers, DrawKind } from "#lib/alerts/alert-layers.ts";
  import { alertVariables, areaText, canAccumulate, conditionUnits, definitionKey } from "#lib/alerts/geo.ts";
  import { problem } from "#lib/alerts/store.svelte.ts";
  import type { RigStatus } from "#lib/alerts/types.ts";
  import { alertsClient } from "#lib/config.ts";
  import { formatTime, formatValue } from "#lib/format.ts";
  import PreviewChart from "./PreviewChart.svelte";

  let {
    variables,
    layers,
    rig,
    alert = null,
    run,
    time,
    onSeek,
    onSaved,
    onCancel,
  }: {
    variables: VariableInfo[];
    layers: AlertLayers;
    rig: RigStatus | null;
    /** The alert to edit, or null for a new one. */
    alert?: Alert | null;
    run?: string;
    time: number;
    onSeek: (ms: number) => void;
    onSaved: (alert: Alert) => void;
    onCancel: () => void;
  } = $props();

  const choices = $derived(alertVariables(variables).toSorted((a, b) => a.name.localeCompare(b.name)));
  const variable = (id: string) => variables.find((v) => v.id === id);
  const OPERATORS: AlertOperator[] = [">=", ">", "<=", "<"];
  const OPERATOR_TEXT: Record<AlertOperator, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<" };
  const TOTALS = [1, 3, 6, 12, 24, 48, 72];

  // The draft. An edit starts from the alert; a new alert from a typical heavy-rain warning.
  const start = untrack(() => alert);
  const receiver = untrack(() => rig?.webhookUrl) ?? "";
  let name = $state(start?.name ?? "");
  let kind = $state<DrawKind>(start && start.area.type !== "Point" ? "polygon" : "point");
  let area = $state.raw<AlertArea | null>(start?.area ?? null);
  let radius = $state(start?.radius_km ?? 25);
  let conditions = $state<AlertCondition[]>(
    start?.conditions.map((c) => ({ ...c })) ?? [{ variable: "precip", operator: ">=", threshold: 25, accumulate_hours: 24 }],
  );
  let match = $state<"all" | "any">(start?.match ?? "all");
  let areaMode = $state<"any" | "mean" | "coverage">(start?.area_mode ?? "any");
  let coverage = $state(start?.coverage_percent ?? 25);
  let leadDays = $state(start?.lead_days ?? 5);
  let minDuration = $state(start?.min_duration_hours ?? 0);
  let sendWebhooks = $state(start ? !!start.webhook : !!receiver);
  let webhookUrl = $state(start?.webhook?.url ?? receiver);

  let drawing = $state(false);
  let preview = $state.raw<AlertPreview | null>(null);
  let previewError = $state<string | null>(null);
  let previewing = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let created = $state.raw<Alert | null>(null);
  let copied = $state(false);

  const point = $derived(area?.type === "Point");
  /** One grid cell: how the area is read makes no difference. */
  const singleCell = $derived(point && radius === 0);
  const definition = $derived(
    area
      ? {
          area,
          radius_km: point ? radius : 0,
          conditions: conditions.map((c) => ({
            ...c,
            threshold: Number(c.threshold),
            accumulate_hours: canAccumulate(variable(c.variable)) ? c.accumulate_hours : null,
          })),
          match,
          area_mode: singleCell ? ("any" as const) : areaMode,
          coverage_percent: !singleCell && areaMode === "coverage" ? coverage : null,
          lead_days: leadDays,
          min_duration_hours: minDuration,
        }
      : null,
  );

  // ------------------------------------------------------------------------------ drawing

  function draw(k: DrawKind) {
    kind = k;
    drawing = true;
    layers.startDraw(k, (a) => {
      area = a;
      drawing = false;
    });
  }

  onMount(() => {
    if (!area) draw(kind);
  });
  onDestroy(() => {
    layers.stopDraw();
    layers.setDraft(null);
  });
  $effect(() => {
    if (!drawing) layers.setDraft(area, point ? radius : 0);
  });

  function keydown(e: KeyboardEvent) {
    if (!drawing) return;
    if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
    if (e.key === "Escape") {
      layers.stopDraw();
      drawing = false;
      layers.setDraft(area, point ? radius : 0);
    } else if (e.key === "Backspace") layers.undoVertex();
    else if (e.key === "Enter") layers.finishPolygon();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ------------------------------------------------------------------------------ preview

  // Ask the forecast service what this definition would report, shortly after the last change.
  let previewKey = "";
  $effect(() => {
    const d = definition;
    if (!d || d.conditions.some((c) => !Number.isFinite(c.threshold))) return;
    const key = definitionKey(d) + run;
    if (key === previewKey) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      previewing = true;
      try {
        preview = await alertsClient.alerts.preview({ ...d, run }, { signal: ctrl.signal });
        previewKey = key;
        previewError = null;
      } catch (e) {
        if ((e as Error).name !== "AbortError") previewError = problem(e);
      } finally {
        previewing = false;
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  // ------------------------------------------------------------------------------ save

  async function save() {
    if (!definition) return;
    saving = true;
    saveError = null;
    const input = {
      ...definition,
      name: name.trim() || "Untitled alert",
      webhook_url: sendWebhooks && webhookUrl.trim() ? webhookUrl.trim() : null,
    };
    try {
      const saved = alert ? await alertsClient.alerts.update(alert.id, input) : await alertsClient.alerts.create(input);
      // The API shows the secret once. The lab's server kept a copy to verify deliveries.
      if (saved.webhook?.secret) created = saved;
      else onSaved(saved);
    } catch (e) {
      saveError = problem(e);
    } finally {
      saving = false;
    }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(created!.webhook!.secret!);
    copied = true;
  }

  function addCondition() {
    conditions.push({ variable: "gust", operator: ">=", threshold: 20, accumulate_hours: null });
  }

  function changeVariable(c: AlertCondition, id: string) {
    c.variable = id;
    if (!canAccumulate(variable(id))) c.accumulate_hours = null;
  }
</script>

<svelte:window onkeydowncapture={keydown} />

{#if created}
  <section class="secret">
    <h3>{alert ? "Webhook added" : "Alert saved"}</h3>
    <p>Notifications are signed with this secret. The API shows it only now, so keep it with your receiver.</p>
    <code>{created.webhook!.secret}</code>
    <div class="row">
      <button onclick={copySecret}>{copied ? "Copied" : "Copy secret"}</button>
      <button class="primary" onclick={() => onSaved(created!)}>Done</button>
    </div>
    <p class="note">This lab kept a copy, so its receiver can verify the deliveries.</p>
  </section>
{:else}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <label class="field">
      <span>Name</span>
      <input bind:value={name} placeholder="Heavy rain over Díli" maxlength="120" />
    </label>

    <fieldset>
      <legend>Area</legend>
      <div class="seg" role="group" aria-label="Area shape">
        <button type="button" class:on={kind === "point"} onclick={() => draw("point")}>Point and radius</button>
        <button type="button" class:on={kind === "polygon"} onclick={() => draw("polygon")}>Polygon</button>
      </div>
      {#if drawing}
        <p class="hint">
          {#if kind === "point"}
            Click the map to place the point.
          {:else}
            Click to add corners; click the first corner, double-click or press Enter to finish. Backspace removes the last one.
          {/if}
          <button type="button" class="link" onclick={() => (layers.stopDraw(), (drawing = false), layers.setDraft(area, point ? radius : 0))}>Cancel</button>
        </p>
      {:else if area}
        <p class="hint">{areaText(area, point ? radius : 0)} <button type="button" class="link" onclick={() => draw(kind)}>Redraw</button></p>
      {/if}
      {#if point}
        <label class="field inline">
          <span>Radius</span>
          <input type="range" min="0" max="250" step="5" bind:value={radius} />
          <output class="num">{radius} km</output>
        </label>
      {/if}
      {#if area && !singleCell}
        <label class="field inline">
          <span>Read as</span>
          <select bind:value={areaMode}>
            <option value="any">Anywhere in it</option>
            <option value="mean">Its average</option>
            <option value="coverage">Over part of it</option>
          </select>
          {#if areaMode === "coverage"}
            <input class="small num" type="number" min="1" max="100" bind:value={coverage} aria-label="Percent of the area" />%
          {/if}
        </label>
      {/if}
    </fieldset>

    <fieldset>
      <legend>Conditions</legend>
      {#each conditions as c, i (i)}
        {@const v = variable(c.variable)}
        <div class="condition">
          <div class="line">
            <select value={c.variable} onchange={(e) => changeVariable(c, e.currentTarget.value)} aria-label="Variable">
              {#each choices as o (o.id)}
                <option value={o.id}>{o.name}</option>
              {/each}
            </select>
            {#if conditions.length > 1}
              <button type="button" class="remove" onclick={() => conditions.splice(i, 1)} aria-label="Remove condition">×</button>
            {/if}
          </div>
          <div class="line">
          <select bind:value={c.operator} aria-label="Comparison" class="op">
            {#each OPERATORS as op (op)}<option value={op}>{OPERATOR_TEXT[op]}</option>{/each}
          </select>
          <input class="num" type="number" step="any" bind:value={c.threshold} aria-label="Threshold" />
          <span class="units">{conditionUnits(c, v)}</span>
          {#if canAccumulate(v)}
            <select bind:value={c.accumulate_hours} aria-label="Over" class="over">
              <option value={null}>per hour</option>
              {#each TOTALS as h (h)}<option value={h}>in {h} h</option>{/each}
            </select>
          {/if}
          </div>
        </div>
      {/each}
      <div class="row">
        {#if conditions.length < 5}<button type="button" class="link" onclick={addCondition}>+ Add a condition</button>{/if}
        {#if conditions.length > 1}
          <label class="field inline right">
            <select bind:value={match}>
              <option value="all">All at once</option>
              <option value="any">Any of them</option>
            </select>
          </label>
        {/if}
      </div>
    </fieldset>

    <fieldset>
      <legend>Warn me</legend>
      <label class="field inline">
        <span>Up to</span>
        <input type="range" min="1" max="16" step="1" bind:value={leadDays} />
        <output class="num">{leadDays} days ahead</output>
      </label>
      <label class="field inline">
        <span>Lasting at least</span>
        <input class="small num" type="number" min="0" max="240" bind:value={minDuration} /> hours
      </label>
    </fieldset>

    <fieldset>
      <legend>Webhook</legend>
      <label class="check"><input type="checkbox" bind:checked={sendWebhooks} /> Send notifications to a webhook</label>
      {#if sendWebhooks}
        <input class="url" type="url" bind:value={webhookUrl} placeholder="https://example.org/hooks/4shadow" />
        {#if rig?.webhookUrl && webhookUrl !== rig.webhookUrl}
          <button type="button" class="link" onclick={() => (webhookUrl = rig!.webhookUrl!)}>Use this lab's receiver</button>
        {:else if !rig?.webhookUrl}
          <p class="hint">To receive them here, run <code>npm run tunnel</code> next to the lab.</p>
        {/if}
      {/if}
    </fieldset>

    <section class="preview" aria-live="polite">
      <h3>
        Forecast for this area
        {#if previewing}<span class="dot" title="Checking"></span>{/if}
      </h3>
      {#if !area}
        <p class="hint">Draw an area to see what this alert would report.</p>
      {:else if previewError}
        <p class="error">{previewError}</p>
      {:else if preview}
        <PreviewChart {preview} {time} {onSeek} />
        {#if preview.events.length}
          <ul class="events">
            {#each preview.events as ev (ev.start)}
              <li>
                <button type="button" onclick={() => onSeek(Date.parse(ev.peak.time))}>
                  <b>From {formatTime(Date.parse(ev.start))}, for {ev.duration_hours} h</b>
                  <span>peak {formatValue(ev.peak.value)} {ev.peak.units} at {formatTime(Date.parse(ev.peak.time))}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">Nothing forecast in the next {leadDays} days: no events now. The alert keeps checking every new run.</p>
        {/if}
        {#each preview.warnings as w (w)}<p class="note">{w}</p>{/each}
      {/if}
    </section>

    {#if saveError}<p class="error">{saveError}</p>{/if}
    <div class="row actions">
      <button type="button" onclick={onCancel}>Cancel</button>
      <button class="primary" type="submit" disabled={!definition || saving}>{saving ? "Saving…" : alert ? "Save changes" : "Create alert"}</button>
    </div>
  </form>
{/if}

<style>
  form,
  .secret {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  legend,
  h3 {
    padding: 0;
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-2);
  }
  .field.inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .field.inline > span {
    min-width: 96px;
  }
  .field.right {
    margin-left: auto;
  }
  input,
  select {
    background: var(--panel-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 7px;
    min-width: 0;
  }
  input[type="range"] {
    flex: 1;
    padding: 0;
    accent-color: var(--accent);
    background: none;
    border: 0;
  }
  input.small {
    width: 62px;
  }
  .url {
    width: 100%;
  }
  output {
    min-width: 92px;
    text-align: right;
    font-size: 12px;
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }
  .seg button {
    flex: 1;
    border: 0;
    padding: 6px;
    background: none;
    color: var(--text-2);
    font-size: 12px;
  }
  .seg button.on {
    background: var(--panel-raised);
    color: var(--text);
    font-weight: 600;
  }
  .condition {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .line > select:first-child:not(.op) {
    flex: 1;
  }
  .condition input {
    width: 80px;
  }
  .condition .op {
    width: 52px;
  }
  .condition .over {
    margin-left: auto;
  }
  .units {
    font-size: 12px;
    color: var(--text-2);
    min-width: 30px;
  }
  .remove {
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 16px;
    padding: 0 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions {
    justify-content: flex-end;
  }
  button {
    border: 1px solid var(--border);
    background: var(--panel-raised);
    border-radius: 7px;
    padding: 6px 12px;
    font-size: 13px;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 12px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-2);
  }
  .check input {
    accent-color: var(--accent);
  }
  .hint,
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  code {
    font-size: 12px;
    background: var(--panel-raised);
    border-radius: 5px;
    padding: 1px 5px;
    word-break: break-all;
  }
  .secret code {
    padding: 8px 10px;
    border: 1px solid var(--border);
  }
  .secret p {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .preview {
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .events {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .events button {
    width: 100%;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    font-size: 12px;
    border-left: 3px solid var(--alert-now, #ff6b5e);
  }
  .events span {
    color: var(--muted);
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
</style>

<script lang="ts">
  import CloseButton from "#lib/components/CloseButton.svelte";
  import type { Alert, AlertArea, AlertDelivery, AlertEvent, AlertTestResult, VariableInfo } from "@similie/4shadow";
  import { ALERT_COLORS, type AlertLayers } from "#lib/alerts/alert-layers.ts";
  import { areaText, definitionText } from "#lib/alerts/geo.ts";
  import { problem, type AlertsStore } from "#lib/alerts/store.svelte.ts";
  import type { Received } from "#lib/alerts/types.ts";
  import { alertsClient } from "#lib/config.ts";
  import { formatTime, formatValue } from "#lib/format.ts";
  import AlertEditor from "./AlertEditor.svelte";

  let {
    store,
    variables,
    layers,
    run,
    time,
    selected = $bindable(null),
    editing = $bindable(null),
    onSeek,
    onFocus,
    onClose,
  }: {
    store: AlertsStore;
    variables: VariableInfo[];
    layers: AlertLayers | null;
    run?: string;
    time: number;
    /** The alert shown in detail (also chosen by clicking it on the map). */
    selected?: string | null;
    /** Set while the editor is open: the alert being changed, or null for a new one. */
    editing?: { alert: Alert | null } | null;
    onSeek: (ms: number) => void;
    /** Fit the map to an area. */
    onFocus: (area: AlertArea, radiusKm: number) => void;
    onClose: () => void;
  } = $props();

  const alert = $derived(store.get(selected));
  const rig = $derived(store.rig);
  const full = $derived(store.limit >= 0 && store.alerts.length >= store.limit);

  // ------------------------------------------------------------------------------ detail state

  let deliveries = $state.raw<AlertDelivery[]>([]);
  let tested = $state.raw<AlertTestResult | null>(null);
  let secret = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let confirmDelete = $state(false);
  let copied = $state(false);

  // A different alert: start its detail afresh and fetch its deliveries.
  $effect(() => {
    const id = selected;
    tested = null;
    secret = null;
    actionError = null;
    confirmDelete = false;
    deliveries = [];
    if (id) loadDeliveries(id);
  });

  // A webhook for this alert arrived: its delivery log has changed too.
  const receivedHere = $derived(store.received.filter((r) => r.alertId === selected));
  $effect(() => {
    if (selected && receivedHere.length) loadDeliveries(selected);
  });

  async function loadDeliveries(id: string) {
    try {
      const { deliveries: list } = await alertsClient.alerts.deliveries(id, { limit: 20 });
      if (id === selected) deliveries = list;
    } catch {
      // Shown as an empty log; the panel's other actions report their own errors.
    }
  }

  /** Run an action on the selected alert, with one shared busy flag and error line. */
  async function act(name: string, fn: (a: Alert) => Promise<void>) {
    if (!alert || busy) return;
    busy = name;
    actionError = null;
    try {
      await fn(alert);
    } catch (e) {
      actionError = problem(e);
    } finally {
      busy = null;
    }
  }

  const toggleActive = () =>
    act("active", async (a) => {
      store.put(await alertsClient.alerts.update(a.id, { active: !a.active }));
      store.refreshSoon(300); // pausing cancels its events; resuming checks it again
    });

  const remove = () =>
    act("delete", async (a) => {
      await alertsClient.alerts.delete(a.id);
      selected = null;
      await store.refresh();
    });

  const test = () =>
    act("test", async (a) => {
      tested = await alertsClient.alerts.test(a.id);
      await loadDeliveries(a.id);
    });

  // The lab's proxy keeps every secret it sees go by, so these also let its receiver verify.
  const rotate = () =>
    act("secret", async (a) => {
      const saved = await alertsClient.alerts.rotateSecret(a.id);
      secret = saved.webhook?.secret ?? null;
      store.put(saved);
      await store.refresh();
    });

  const sendHere = () =>
    act("webhook", async (a) => {
      const saved = await alertsClient.alerts.update(a.id, { webhook_url: rig!.webhookUrl });
      secret = saved.webhook?.secret ?? null;
      store.put(saved);
      await store.refresh();
    });

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function open(a: Alert) {
    selected = a.id;
    onFocus(a.area, a.radius_km);
  }

  function saved(a: Alert) {
    editing = null;
    store.put(a);
    selected = a.id;
    onFocus(a.area, a.radius_km);
    store.refresh(); // its events (checked on save) and whether the lab holds its secret
  }

  // ------------------------------------------------------------------------------ wording

  function status(a: Alert): { text: string; tone: "now" | "later" | "quiet" | "problem" } {
    if (a.evaluation.error) return { text: "Couldn't check", tone: "problem" };
    if (!a.active) return { text: "Paused", tone: "quiet" };
    if (a.evaluation.pending) return { text: "Checking…", tone: "quiet" };
    const events = store.eventsOf(a.id);
    if (events.some((e) => Date.parse(e.start) <= time && time <= Date.parse(e.end))) return { text: "On at map time", tone: "now" };
    if (events.length) return { text: events.length === 1 ? "1 event" : `${events.length} events`, tone: "later" };
    return { text: "Nothing forecast", tone: "quiet" };
  }

  const eventOn = (e: AlertEvent) => Date.parse(e.start) <= time && time <= Date.parse(e.end);
  const peakText = (e: AlertEvent) =>
    `peak ${formatValue(e.peak.value)} ${e.peak.units} at ${formatTime(Date.parse(e.peak.time))}` +
    (e.max_coverage_percent !== null ? `; up to ${Math.round(e.max_coverage_percent)}% of the area` : "");

  const TYPE_TEXT: Record<string, string> = {
    "alert.event.created": "New event",
    "alert.event.updated": "Event changed",
    "alert.event.cancelled": "Event cancelled",
    "alert.test": "Test",
  };
  const typeText = (t: string | undefined) => (t ? (TYPE_TEXT[t] ?? t) : "Unrecognised request");

  function deliveryText(d: AlertDelivery): string {
    if (d.status === "delivered") return `Delivered${d.response_status ? ` (${d.response_status})` : ""}`;
    if (d.status === "failed") return `Failed after ${d.attempts} ${d.attempts === 1 ? "try" : "tries"}${d.response_status ? ` (${d.response_status})` : ""}`;
    if (d.status === "pending" && d.attempts > 0) return `Retrying${d.next_attempt_at ? ` at ${formatTime(Date.parse(d.next_attempt_at))}` : ""}`;
    return d.status[0]!.toUpperCase() + d.status.slice(1);
  }

  const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");
  const ago = (iso: string) => formatTime(Date.parse(iso));
</script>

{#snippet receivedList(items: Received[])}
  <ul class="log">
    {#each items as r (r.receivedAt + r.webhookId)}
      <li>
        <span class="when num">{ago(r.receivedAt)}</span>
        <span>{typeText(r.webhook?.type)}{r.webhook?.data.alert && !selected ? `: ${r.webhook.data.alert.name}` : ""}</span>
        {#if r.verified}
          <span class="tag ok">Signature checked</span>
        {:else}
          <span class="tag bad" title={r.error}>Not verified</span>
        {/if}
        {#if r.duplicate}<span class="tag">Retry</span>{/if}
        {#if !r.verified && r.error}<p class="why">{r.error}</p>{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<aside class="alerts panel" aria-label="Early warnings" style:--alert-now={ALERT_COLORS.now} style:--alert-later={ALERT_COLORS.later}>
  <header>
    <div>
      <h2>Early warnings</h2>
      <p>
        {#if store.limit < 0}{store.alerts.length} alerts{:else}{store.alerts.length} of {store.limit} alerts on your plan{/if}
      </p>
    </div>
    <CloseButton onclick={onClose} />
  </header>

  {#if store.error}<p class="error">{store.error}</p>{/if}

  {#if !rig}
    <p class="muted">Asking the lab's server…</p>
  {:else if !rig.keyConfigured}
    <div class="setup">
      <p>Alerts belong to an API key, so the lab needs yours. Put it in <code>apps/map-lab/.env.local</code>:</p>
      <code class="block">FORESHADOW_API_KEY=your-key</code>
      <p>and restart the lab. The key stays on the lab's server: the browser talks to <code>/api/4shadow</code>, which adds it.</p>
    </div>
  {:else if editing}
    {#if layers}
      <AlertEditor
        {variables}
        {layers}
        {rig}
        {run}
        {time}
        {onSeek}
        alert={editing.alert}
        onSaved={saved}
        onCancel={() => (editing = null)}
      />
    {/if}
  {:else if alert}
    {@const s = status(alert)}
    <!-- One alert -->
    <button class="back link" onclick={() => (selected = null)}>← All alerts</button>
    <div class="title">
      <h3>{alert.name}</h3>
      <span class="status {s.tone}"><i></i>{s.text}</span>
    </div>
    <p class="what">{definitionText(alert, variables)}, over {areaText(alert.area, alert.radius_km)}, up to {alert.lead_days} days ahead{alert.min_duration_hours ? `, lasting ${alert.min_duration_hours} h or more` : ""}.</p>
    {#if alert.evaluation.error}<p class="error">{alert.evaluation.error}</p>{/if}
    <p class="muted small">
      {#if alert.evaluation.run}Checked against the {alert.evaluation.run.slice(8)}Z run of {alert.evaluation.run.slice(0, 4)}-{alert.evaluation.run.slice(4, 6)}-{alert.evaluation.run.slice(6, 8)}.{:else}Not checked yet.{/if}
      Every new run checks it again.
    </p>

    <div class="row">
      <button onclick={() => (editing = { alert: alert! })}>Edit</button>
      <button onclick={toggleActive} disabled={!!busy}>{alert.active ? "Pause" : "Resume"}</button>
      {#if confirmDelete}
        <span class="confirm">
          Delete it and its history?
          <button class="danger" onclick={remove} disabled={!!busy}>Delete</button>
          <button onclick={() => (confirmDelete = false)}>Keep</button>
        </span>
      {:else}
        <button class="quiet" onclick={() => (confirmDelete = true)}>Delete</button>
      {/if}
    </div>
    {#if actionError}<p class="error">{actionError}</p>{/if}

    <section>
      <h4>Events</h4>
      {#each store.eventsOf(alert.id).toSorted((a, b) => a.start.localeCompare(b.start)) as e (e.id)}
        <button class="event" class:on={eventOn(e)} onclick={() => (onSeek(Date.parse(e.peak.time)), onFocus(alert!.area, alert!.radius_km))}>
          <span class="status {eventOn(e) ? 'now' : 'later'}"><i></i>{eventOn(e) ? "On at map time" : e.status === "ongoing" ? "Under way" : "Coming"}</span>
          <b class="num">{formatTime(Date.parse(e.start))} to {formatTime(Date.parse(e.end))}</b>
          <span class="muted">{e.duration_hours} h, {peakText(e)}</span>
        </button>
      {:else}
        <p class="muted small">Nothing in the latest forecast meets the conditions.</p>
      {/each}
    </section>

    <section>
      <h4>Webhook</h4>
      {#if alert.webhook}
        <p class="small"><span class="muted">Sends to</span> <span class="url">{shortUrl(alert.webhook.url)}</span></p>
        <p class="small">
          <span class="muted">Secret</span> <code>{alert.webhook.secret_hint}</code>
          {#if rig.secrets.includes(alert.id)}
            <span class="tag ok">The lab has it</span>
          {:else}
            <span class="tag" title="Its secret was shown before the lab saw it. A new secret lets the lab verify deliveries.">The lab doesn't have it</span>
          {/if}
        </p>
        {#if secret}
          <div class="secret">
            <p class="small">New secret, shown only now. The lab kept a copy.</p>
            <code class="block">{secret}</code>
            <button onclick={() => copy(secret!)}>{copied ? "Copied" : "Copy"}</button>
          </div>
        {/if}
        <div class="row">
          <button onclick={test} disabled={!!busy}>{busy === "test" ? "Sending…" : "Send a test"}</button>
          <button onclick={rotate} disabled={!!busy}>New secret</button>
          {#if rig.webhookUrl && alert.webhook.url !== rig.webhookUrl}
            <button onclick={sendHere} disabled={!!busy}>Send to this lab</button>
          {/if}
        </div>
        {#if tested}
          <p class="small {tested.delivered ? '' : 'error'}">
            {tested.delivered ? "Delivered" : "Not delivered"} in {tested.duration_ms} ms{tested.delivery.response_status ? `, answered ${tested.delivery.response_status}` : ""}{tested.delivery.error ? `: ${tested.delivery.error}` : ""}.
          </p>
        {/if}
        {#if deliveries.length}
          <h5>Sent</h5>
          <ul class="log">
            {#each deliveries as d (d.id)}
              <li>
                <span class="when num">{ago(d.created_at)}</span>
                <span>{typeText(d.type)}</span>
                <span class="tag" class:ok={d.status === "delivered"} class:bad={d.status === "failed"} title={d.error ?? undefined}>{deliveryText(d)}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if receivedHere.length}
          <h5>Received here</h5>
          {@render receivedList(receivedHere.slice(0, 10))}
        {/if}
      {:else}
        <p class="muted small">None: events show here and on your map only.</p>
        {#if rig.webhookUrl}
          <button onclick={sendHere} disabled={!!busy}>Send to this lab</button>
        {/if}
      {/if}
    </section>
  {:else}
    <!-- All alerts -->
    <p class="rig small">
      {#if rig.webhookUrl}
        <span class="status ok"><i></i>Receiving webhooks</span> at <span class="url">{shortUrl(rig.webhookUrl)}</span>
      {:else}
        <span class="status quiet"><i></i>Not receiving webhooks</span>. Run <code>npm run tunnel</code> next to the lab to get them here.
      {/if}
    </p>

    {#if store.loaded && !store.alerts.length}
      <p class="muted">
        No alerts yet. An alert watches an area for conditions, such as 50 mm of rain in a day, in every new forecast,
        and tells your webhook days ahead.
      </p>
    {/if}
    <ul class="list">
      {#each store.alerts as a (a.id)}
        {@const s = status(a)}
        <li>
          <button onclick={() => open(a)}>
            <span class="name">{a.name}</span>
            <span class="status {s.tone}"><i></i>{s.text}</span>
            <span class="muted small">{definitionText(a, variables)}</span>
          </button>
        </li>
      {/each}
    </ul>
    <button class="primary" onclick={() => (editing = { alert: null })} disabled={full || !layers}>New alert</button>
    {#if full}<p class="muted small">Your plan allows {store.limit}. Delete one to add another.</p>{/if}

    {#if store.received.length}
      <section>
        <h4>Webhooks received</h4>
        {@render receivedList(store.received.slice(0, 8))}
      </section>
    {/if}
  {/if}
</aside>

<style>
  .alerts {
    width: 420px;
    max-height: calc(100vh - 150px);
    overflow-y: auto;
    padding: 14px 16px 16px;
    background: rgba(20, 24, 30, 0.96);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
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
  h3 {
    margin: 0;
    font-size: 15px;
  }
  h4,
  h5 {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  h5 {
    margin-top: 10px;
  }
  p {
    margin: 0;
  }
  section {
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  button {
    border: 1px solid var(--border);
    background: var(--panel-raised);
    border-radius: 7px;
    padding: 6px 12px;
    font-size: 13px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    align-self: flex-start;
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
    font-weight: 600;
  }
  button.quiet {
    background: none;
    color: var(--text-2);
  }
  button.danger {
    background: var(--danger);
    color: #fff;
    border-color: transparent;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 12px;
    align-self: flex-start;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .confirm {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-2);
  }
  .title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .what {
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.45;
  }
  .small {
    font-size: 12px;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--danger);
    font-size: 12px;
  }
  .url {
    word-break: break-all;
  }
  code {
    font-size: 12px;
    background: var(--panel-raised);
    border-radius: 5px;
    padding: 1px 5px;
    word-break: break-all;
  }
  code.block {
    display: block;
    padding: 7px 9px;
    border: 1px solid var(--border);
    margin: 6px 0;
  }
  .setup p {
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.45;
  }
  .rig {
    color: var(--text-2);
    line-height: 1.6;
  }

  /* Status: a dot in the alert colours, always with words. */
  .status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .status i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .status.now i {
    background: var(--alert-now);
  }
  .status.later i {
    background: var(--alert-later);
  }
  .status.ok i {
    background: #6fcf97;
  }
  .status.problem i {
    background: var(--danger);
  }
  .status.now,
  .status.problem {
    color: var(--text);
    font-weight: 600;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .list button {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 10px;
    text-align: left;
    padding: 9px 11px;
  }
  .list .name {
    font-weight: 600;
  }
  .list .small {
    grid-column: 1 / -1;
  }

  .event {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 7px 10px;
    margin-bottom: 5px;
    font-size: 12px;
    border-left: 3px solid var(--alert-later);
  }
  .event.on {
    border-left-color: var(--alert-now);
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
  }
  .log li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  .log .when {
    color: var(--muted);
    min-width: 112px;
  }
  .why {
    flex-basis: 100%;
    color: var(--muted);
    padding-left: 120px;
  }
  .tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 9px;
    border: 1px solid var(--border);
    color: var(--text-2);
  }
  .tag.ok {
    border-color: rgba(111, 207, 151, 0.5);
  }
  .tag.bad {
    border-color: var(--danger);
    color: var(--text);
  }
  .secret {
    margin: 8px 0;
  }
</style>

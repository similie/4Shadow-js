<script lang="ts">
  import type { Place } from "@similie/4shadow";
  import { client } from "#lib/config.ts";

  let { onPick }: { onPick: (p: { lat: number; lon: number; place?: Place }) => void } = $props();

  let query = $state("");
  let results: Place[] = $state.raw([]);
  let active = $state(-1);
  let open = $state(false);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;

  const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

  function search(q: string) {
    clearTimeout(timer);
    error = null;
    if (q.trim().length < 2 || COORDS.test(q)) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await client.searchPlaces(q, { limit: 7, signal: controller.signal });
        results = res.results;
        active = results.length ? 0 : -1;
        open = true;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        results = [];
        error = (e as Error).message;
      }
    }, 180);
  }

  function pick(p: Place) {
    query = p.display_name;
    open = false;
    onPick({ lat: p.lat, lon: p.lon, place: p });
  }

  function submit() {
    const m = COORDS.exec(query);
    if (m) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        open = false;
        onPick({ lat, lon });
      }
      return;
    }
    const p = results[active] ?? results[0];
    if (p) pick(p);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      active = Math.min(results.length - 1, active + 1);
      open = true;
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(0, active - 1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      submit();
    } else if (e.key === "Escape") {
      open = false;
      (e.target as HTMLInputElement).blur();
    }
  }
</script>

<div class="search">
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
    <path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
  <input
    type="search"
    placeholder="Search a place, or lat, lon"
    aria-label="Search places"
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
    oninput={() => search(query)}
    onkeydown={keydown}
    onfocus={() => (open = results.length > 0)}
    onblur={() => setTimeout(() => (open = false), 150)}
  />
  {#if open && results.length}
    <ul class="results panel" role="listbox">
      {#each results as p, i (p.geonames_id)}
        <li role="option" aria-selected={i === active}>
          <button class:active={i === active} onmousedown={() => pick(p)} onmouseenter={() => (active = i)}>
            <span class="name">{p.display_name}</span>
            <span class="kind">{p.kind}{p.population ? ` · ${p.population.toLocaleString()}` : ""}</span>
          </button>
        </li>
      {/each}
      <li class="attribution">Place names: GeoNames, CC BY 4.0</li>
    </ul>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .search {
    position: relative;
    width: 100%;
  }
  .icon {
    position: absolute;
    left: 11px;
    top: 50%;
    width: 16px;
    height: 16px;
    transform: translateY(-50%);
    color: var(--muted);
    pointer-events: none;
  }
  input {
    width: 100%;
    height: 38px;
    padding: 0 12px 0 34px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--panel);
    backdrop-filter: blur(10px);
    outline: none;
  }
  input:focus {
    border-color: rgba(127, 209, 255, 0.5);
  }
  .results {
    position: absolute;
    top: 44px;
    left: 0;
    right: 0;
    margin: 0;
    padding: 4px;
    list-style: none;
    z-index: 5;
  }
  .results button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: 7px;
    background: none;
    text-align: left;
  }
  .results button.active {
    background: rgba(255, 255, 255, 0.07);
  }
  .name {
    font-weight: 500;
  }
  .kind {
    font-size: 12px;
    color: var(--muted);
  }
  .attribution {
    padding: 6px 10px 3px;
    font-size: 11px;
    color: var(--muted);
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .error {
    margin: 6px 2px 0;
    font-size: 12px;
    color: var(--danger);
  }
</style>

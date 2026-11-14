<script lang="ts">
  let { onclick, label = "Close" }: { onclick: () => void; label?: string } = $props();
</script>

<!-- An icon, not "×": a glyph sits where its font puts it, off the button's centre. -->
<button {onclick} aria-label={label} title={label}>
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
</button>

<style>
  button {
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 7px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-2);
  }
  button:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.05);
  }
  svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
</style>

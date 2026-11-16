#!/usr/bin/env node
/**
 * Takes the README's screenshots and the wind animation from a running lab, with headless Chrome
 * driven over the DevTools protocol (no extra packages). Start the lab first (`npm run lab`), then:
 *
 *   node apps/map-lab/scripts/screenshots.mjs [--base http://localhost:5181] [--out docs/images] [--only hero,wind] [--mp4]
 *
 * Needs Google Chrome (or set CHROME to another Chromium) and, for the animation, ffmpeg and img2webp
 * (libwebp). Images are real output: whatever the latest forecast run shows when you take them.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:5181");
const OUT = resolve(arg("out", "docs/images"));
const ONLY = arg("only", "")?.split(",").filter(Boolean) ?? [];
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1600;
const HEIGHT = 960;
const PORT = 9333;

// ----------------------------------------------------------------------------- a tiny CDP client

class Page {
  #ws;
  #id = 0;
  #pending = new Map();
  #inflight = new Set();
  #lastNetwork = Date.now();
  #listeners = new Map();

  static async open(url) {
    const page = new Page();
    page.#ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      page.#ws.onopen = ok;
      page.#ws.onerror = fail;
    });
    page.#ws.onmessage = (m) => page.#message(JSON.parse(m.data));
    return page;
  }

  #message(msg) {
    if (msg.id) {
      const p = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) p?.fail(new Error(`${msg.error.message} (${p.method})`));
      else p?.ok(msg.result);
      return;
    }
    const { method, params } = msg;
    if (method === "Network.requestWillBeSent") this.#inflight.add(params.requestId);
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") this.#inflight.delete(params.requestId);
    if (method?.startsWith("Network.")) this.#lastNetwork = Date.now();
    if (method === "Runtime.consoleAPICalled" && params.type === "error") console.warn("  page:", params.args.map((a) => a.value ?? a.description).join(" "));
    for (const fn of this.#listeners.get(method) ?? []) fn(params);
  }

  on(method, fn) {
    this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), fn]);
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.#pending.set(id, { ok, fail, method }));
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Until nothing has loaded for `quiet` ms (map data, tiles, fonts), then `settle` ms for the particles' trails. */
  async idle({ quiet = 1500, settle = 2500, max = 45_000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < max) {
      if (this.#inflight.size === 0 && Date.now() - this.#lastNetwork > quiet) break;
      await sleep(200);
    }
    await sleep(settle);
  }

  close() {
    this.#ws.close();
  }
}

// ----------------------------------------------------------------------------- in the page

/** Helpers put into the page: click by text, and click the map at a place (as a person would). */
const HELPERS = `
  window.__shots = {
    click(selector, text) {
      // Layer buttons start with an icon, so the label is what follows it.
      const all = [...document.querySelectorAll(selector)];
      const label = (e) => e.textContent.replace(/\\s+/g, " ").trim();
      const words = (e) => label(e).replace(/^[^A-Za-z]+/, "");
      const el = all.find((e) => words(e) === text) ?? all.find((e) => words(e).startsWith(text));
      if (!el) throw new Error("No " + selector + " starting with " + text);
      el.click();
    },
    check(label, on) {
      const el = [...document.querySelectorAll("label")].find((e) => e.textContent.trim().endsWith(label));
      const box = el?.querySelector("input");
      if (!box) throw new Error("No checkbox " + label);
      if (box.checked !== on) box.click();
    },
    mapClick(lon, lat) {
      const map = window.weatherMap.map;
      const point = map.project([lon, lat]);
      map.fire("click", { lngLat: map.unproject(point), point, originalEvent: new MouseEvent("click") });
    },
  };
`;

const SHOTS = [
  { name: "hero", view: "2.3/-12/138", setup: [] },
  { name: "globe", view: "2.6/22/-38", setup: [["check", "Globe", true], ["layer", "Temperature"]] },
  { name: "temperature", view: "3.6/48/12", setup: [["layer", "Temperature"]] },
  { name: "waves", view: "3/-38/130", setup: [["layer", "Waves"]] },
  { name: "rain", view: "3.4/12/112", setup: [["layer", "Rain"]] },
  { name: "day", view: "3/34/-40", setup: [["check", "Day map", true], ["layer", "Pressure"]] },
  { name: "point-forecast", view: "5.2/-9/126.5", setup: [["mapClick", 125.57, -8.56]] },
  {
    name: "early-warnings",
    view: "5.2/-9/126.5",
    setup: [["layer", "Rain"], ["click", "button", "Early warnings"], ["click", "button", "New alert"], ["mapClick", 125.9, -8.8]],
  },
];

async function setUp(page, steps) {
  for (const [kind, ...a] of steps) {
    if (kind === "layer") await page.eval(`__shots.click("nav.layers button", ${JSON.stringify(a[0])})`);
    else if (kind === "check") await page.eval(`__shots.check(${JSON.stringify(a[0])}, ${a[1]})`);
    else if (kind === "click") await page.eval(`__shots.click(${JSON.stringify(a[0])}, ${JSON.stringify(a[1])})`);
    else if (kind === "mapClick") await page.eval(`__shots.mapClick(${a[0]}, ${a[1]})`);
    await sleep(600);
  }
}

async function open(page, view) {
  await page.send("Page.navigate", { url: "about:blank" });
  await page.send("Page.navigate", { url: `${BASE}/#${view}` });
  await page.idle({ settle: 500 });
  await page.eval(HELPERS);
  for (let i = 0; i < 100 && !(await page.eval("!!window.weatherMap")); i++) await sleep(200);
}

async function shoot(page, file) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log("  wrote", file);
}

/** A few seconds of the map as frames, then an animated WebP and an MP4 with ffmpeg. */
async function animate(page, name, seconds = 4) {
  const dir = mkdtempSync(join(tmpdir(), "4shadow-frames-"));
  const times = [];
  page.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
    times.push(metadata.timestamp);
    writeFileSync(join(dir, `${String(times.length).padStart(4, "0")}.jpg`), Buffer.from(data, "base64"));
    await page.send("Page.screencastFrameAck", { sessionId });
  });
  await page.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT });
  await sleep(seconds * 1000);
  await page.send("Page.stopScreencast");
  await sleep(300);
  const fps = Math.max(8, Math.min(30, Math.round(times.length / ((times.at(-1) - times[0]) || 1))));
  console.log(`  ${times.length} frames, about ${fps} fps`);
  const run = (cmd, args) =>
    new Promise((ok, fail) => spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] }).on("exit", (c) => (c ? fail(new Error(`${cmd} exited ${c}`)) : ok())));
  const input = ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(dir, "%04d.jpg")];
  // MP4 for anywhere that plays video; animated WebP (via img2webp: ffmpeg builds often lack a WebP
  // encoder) for the README, where GitHub shows images but not video files from the repository.
  if (process.argv.includes("--mp4")) {
    await run("ffmpeg", [...input, "-vf", "scale=1600:-2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", join(OUT, `${name}.mp4`)]);
  }
  // A 16:7 band from the middle, 880 px wide, 12 frames a second: small enough for a README.
  await run("ffmpeg", [...input, "-t", String(seconds), "-vf", "fps=12,crop=iw:iw*7/16,scale=880:-2:flags=lanczos", join(dir, "s%04d.png")]);
  const stills = readdirSync(dir).filter((f) => /^s\d+\.png$/.test(f)).sort().map((f) => join(dir, f));
  await run("img2webp", ["-loop", "0", "-lossy", "-q", "45", "-m", "6", "-d", "83", ...stills, "-o", join(OUT, `${name}.webp`)]);
  console.log("  wrote", join(OUT, `${name}.webp`));
  rmSync(dir, { recursive: true, force: true });
}

// ----------------------------------------------------------------------------- run

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "4shadow-chrome-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-swiftshader",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      .then((r) => r.json())
      .then((list) => list.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  if (!target) throw new Error("Chrome didn't start");
  const page = await Page.open(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Network.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });

  for (const shot of SHOTS) {
    if (ONLY.length && !ONLY.includes(shot.name)) continue;
    console.log(shot.name);
    await open(page, shot.view);
    await setUp(page, shot.setup);
    await page.idle();
    await shoot(page, join(OUT, `${shot.name}.png`));
  }
  if (!ONLY.length || ONLY.includes("wind")) {
    console.log("wind (animation)");
    await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await open(page, SHOTS[0].view);
    // The map alone: panels, legend and controls hidden.
    await page.eval(`document.head.insertAdjacentHTML("beforeend", "<style>.top-left,.layers,.bottom,.maplibregl-control-container{display:none!important}</style>")`);
    await page.idle();
    await animate(page, "wind");
  }
  page.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}

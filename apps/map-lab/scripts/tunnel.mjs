#!/usr/bin/env node
/**
 * Puts the lab's webhook receiver on the internet with a Cloudflare quick tunnel (no account needed),
 * so 4Shadow can deliver early-warning webhooks to your machine. The lab picks up the address and
 * fills it in for new alerts. Only POST /hooks/4shadow answers through the tunnel; everything else
 * stays local (src/lib/server/local-only.ts).
 *
 *   npm run tunnel            (with the lab running: npm run lab)
 *
 * Quick tunnel addresses change every run. Point an existing alert at the new one with "Use this lab"
 * in its webhook settings. With ngrok instead: ngrok http 5181, then set WEBHOOK_URL in .env.local.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const port = process.env.PORT ?? "5181";
const dir = fileURLToPath(new URL("../.rig/", import.meta.url));
const file = dir + "tunnel-url";
mkdirSync(dir, { recursive: true, mode: 0o700 });

const cf = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
  stdio: ["ignore", "pipe", "pipe"],
});
cf.on("error", (e) => {
  console.error(
    e.code === "ENOENT"
      ? "cloudflared isn't installed (brew install cloudflared, or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)."
      : e.message,
  );
  process.exit(1);
});

let url = null;
const scan = (chunk) => {
  const m = !url && String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m) return;
  url = m[0];
  writeFileSync(file, url + "\n", { mode: 0o600 });
  console.log(`\nWebhooks can reach the lab at ${url}/hooks/4shadow`);
  console.log("New alerts in the lab use it. It lasts while this runs (Ctrl-C to stop).\n");
};
cf.stdout.on("data", scan);
cf.stderr.on("data", scan);

const stop = () => {
  rmSync(file, { force: true });
  cf.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
cf.on("exit", (code) => {
  rmSync(file, { force: true });
  process.exit(url ? 0 : (code ?? 1));
});

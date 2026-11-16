import { describe, expect, it } from "vitest";
import { allowed, isLocal, WEBHOOK_PATH } from "./local-only.ts";

describe("who may use the lab's server", () => {
  it("knows this machine from a tunnel or a proxy", () => {
    expect(isLocal("localhost:5181", {})).toBe(true);
    expect(isLocal("127.0.0.1:5181", new Headers())).toBe(true);
    expect(isLocal("[::1]:5181", {})).toBe(true);
    expect(isLocal("my-lab.trycloudflare.com", {})).toBe(false);
    // A tunnel that rewrites the Host header still adds its own headers.
    expect(isLocal("localhost:5181", { "cf-connecting-ip": "203.0.113.5" })).toBe(false);
    expect(isLocal("localhost:5181", new Headers({ "x-forwarded-for": "203.0.113.5" }))).toBe(false);
  });

  it("locally: through a tunnel, the internet may only deliver webhooks", () => {
    const tunnel = { "x-forwarded-for": "203.0.113.5" };
    expect(allowed("POST", WEBHOOK_PATH, "lab.trycloudflare.com", tunnel)).toBe(true);
    expect(allowed("GET", WEBHOOK_PATH, "lab.trycloudflare.com", tunnel)).toBe(false);
    expect(allowed("GET", "/api/4shadow/v2/alerts", "lab.trycloudflare.com", tunnel)).toBe(false);
    expect(allowed("GET", "/", "lab.trycloudflare.com", tunnel)).toBe(false);
    expect(allowed("DELETE", "/api/4shadow/v2/alerts/1", "localhost:5181", {})).toBe(true);
  });

  it("public: anyone may read, nobody may write, and the early-warning rig is closed", () => {
    const visitor = { "x-forwarded-for": "203.0.113.5" };
    const pub = (method: string, path: string) => allowed(method, path, "map.example.com", visitor, "public");
    expect(pub("GET", "/")).toBe(true);
    expect(pub("GET", "/api/4shadow/v2/gfs/runs")).toBe(true);
    expect(pub("HEAD", "/favicon.svg")).toBe(true);
    expect(pub("POST", "/api/4shadow/v2/alerts")).toBe(false);
    expect(pub("POST", WEBHOOK_PATH)).toBe(false);
    expect(pub("GET", "/api/rig")).toBe(false);
    expect(pub("GET", "/api/rig/feed")).toBe(false);
    // The same goes for this machine.
    expect(allowed("POST", "/api/4shadow/v2/alerts", "localhost:5181", {}, "public")).toBe(false);
  });
});

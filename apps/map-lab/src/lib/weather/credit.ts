import type { RunDetail } from "@similie/4shadow";

/** A run's credit: its source's attribution when the licence asks for one, else who made it. */
export function creditFor(run: RunDetail): string {
  const source = run.source ?? {};
  if (typeof source.attribution === "string" && source.attribution) return source.attribution;
  const org = typeof source.provider === "string" ? source.provider.split(/[\s/,]/)[0] : "";
  return `Forecast: ${org || run.model.toUpperCase()} via 4Shadow`;
}

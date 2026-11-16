import { Field, type FieldHeader } from "@similie/4shadow";

/** Deep-water group speed per second of wave period: g / (4π) m/s. Wave energy travels at this speed. */
const GROUP_SPEED_PER_S = 9.81 / (4 * Math.PI);
const SCALE = 0.01;
const MISSING = -32768;

const flows = new WeakMap<Field, Map<string, Field>>();

/**
 * How a wave system moves, as a vector field the particle layer can animate: eastward and
 * northward components ("u", "v") in m/s. Waves travel opposite to the direction they come
 * from, at the deep-water group speed (about 0.78 m/s per second of period), so long swell
 * visibly outruns short wind waves. Land and sea ice stay missing.
 */
export function waveFlow(field: Field, dirVar: string, periodVar: string): Field {
  let byVars = flows.get(field);
  if (!byVars) flows.set(field, (byVars = new Map()));
  const key = `${dirVar},${periodVar}`;
  const hit = byVars.get(key);
  if (hit) return hit;

  const dir = field.values(dirVar);
  const period = field.values(periodVar);
  const u = new Int16Array(dir.length);
  const v = new Int16Array(dir.length);
  for (let i = 0; i < dir.length; i++) {
    const d = dir[i]!;
    const T = period[i]!;
    if (Number.isNaN(d) || Number.isNaN(T)) {
      u[i] = MISSING;
      v[i] = MISSING;
      continue;
    }
    const speed = GROUP_SPEED_PER_S * T;
    const toward = ((d + 180) * Math.PI) / 180; // where the waves are heading, clockwise from north
    u[i] = Math.round((Math.sin(toward) * speed) / SCALE);
    v[i] = Math.round((Math.cos(toward) * speed) / SCALE);
  }
  const variable = (id: string, name: string) => ({
    id,
    name,
    units: "m/s",
    semantics: "instant" as const,
    scale: SCALE,
    offset: 0,
  });
  const header: FieldHeader = {
    ...field.header,
    variables: [variable("u", "Wave motion, eastward"), variable("v", "Wave motion, northward")],
  };
  const flow = new Field(
    header,
    new Map([
      ["u", u],
      ["v", v],
    ]),
  );
  byVars.set(key, flow);
  return flow;
}

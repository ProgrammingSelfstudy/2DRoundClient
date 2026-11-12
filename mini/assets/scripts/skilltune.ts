// Hand-made corrections to how skills are played, kept apart from the original's tables: tables/skill_fx.json says how the original plays a skill,
// this file's data (pipeline/skill_tune.json, edited with the ?skilltune= page, shipped as tables/skill_tune.json) says where we deviate.
// Everything absent means "as the original". Plain functions on plain data, so the plan and the effects only ask.
import type { MovePlan } from "./skillplan";

// the movement fields of a MovePlan a correction may replace (seconds for the delays and times, grid cells or pixels for the offsets, as MovePlan)
export const MOVE_KEYS = ["delay", "time", "x", "y", "backDelay", "backTime", "backX"] as const;
export type MoveKey = typeof MOVE_KEYS[number];

export interface FxTune { dx?: number; dy?: number; scale?: number; delay?: number } // pixels, pixels, a factor, seconds
export interface Tune {
  anim: { [modelAnim: string]: { speed?: number } }; // "<model>/<animation>": the playing speed as a factor of the normal one
  move: { [modelAnim: string]: Partial<Record<MoveKey, number>> }; // "<model>/<animation>": the run to the target and back
  fx: { [entity: string]: FxTune }; // an effect entity (tables/skill_fx_res.json) by its id
}

const empty = (): Tune => ({ anim: {}, move: {}, fx: {} });
let current: Tune = empty();

export const tune = (): Tune => current;
export const setTune = (t: Partial<Tune> | null | undefined): void => {
  current = { anim: t?.anim ?? {}, move: t?.move ?? {}, fx: t?.fx ?? {} };
};

export const animKey = (model: string, anim: string) => `${model}/${anim}`;

export const speedOf = (model: string, anim: string): number => {
  const s = current.anim[animKey(model, anim)]?.speed;
  return typeof s === "number" && s > 0 ? s : 1;
};

export function applyMove(p: MovePlan, model: string, anim: string): MovePlan {
  const o = current.move[animKey(model, anim)];
  if (!o) return p;
  const out = { ...p };
  for (const k of MOVE_KEYS) if (typeof o[k] === "number") out[k] = o[k] as number;
  return out;
}

export const fxOf = (entity: number | string): Required<FxTune> => {
  const t = current.fx[String(entity)];
  return { dx: t?.dx ?? 0, dy: t?.dy ?? 0, scale: t?.scale && t.scale > 0 ? t.scale : 1, delay: t?.delay && t.delay > 0 ? t.delay : 0 };
};

// What a save writes: only the values that differ from the original's, so a field put back to its default leaves the file.
export function pruned(t: Tune, base: { move?: { [k: string]: MovePlan } } = {}): Tune {
  const out = empty();
  for (const [k, v] of Object.entries(t.anim)) if (v.speed !== undefined && v.speed !== 1) out.anim[k] = { speed: v.speed };
  for (const [k, v] of Object.entries(t.move)) {
    const b = base.move?.[k];
    const keep: Partial<Record<MoveKey, number>> = {};
    for (const m of MOVE_KEYS) if (typeof v[m] === "number" && (!b || b[m] !== v[m])) keep[m] = v[m];
    if (Object.keys(keep).length) out.move[k] = keep;
  }
  for (const [k, v] of Object.entries(t.fx)) {
    const keep: FxTune = {};
    if (v.dx) keep.dx = v.dx;
    if (v.dy) keep.dy = v.dy;
    if (v.scale && v.scale !== 1) keep.scale = v.scale;
    if (v.delay) keep.delay = v.delay;
    if (Object.keys(keep).length) out.fx[k] = keep;
  }
  return out;
}

// The correction file: the dev server's copy first (it is what ?skilltune= saves, so the page sees a save at once), then the release's.
export async function loadTune(loadRelease: () => Promise<Tune>): Promise<void> {
  try {
    const r = await fetch("/tune/skill_tune.json", { cache: "no-cache" });
    if (r.ok) { setTune(await r.json()); return; }
  } catch { /* no dev server */ }
  try { setTune(await loadRelease()); } catch { setTune(null); } // an older release has no file
}

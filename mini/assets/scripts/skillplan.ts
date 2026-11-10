// How a skill is played, worked out from tables/skill_fx.json (pipeline/skill_fx_table.py) with the original's rules: which animation the attacker
// plays, where it runs to and back from (BattleModel.moveTo / moveToArea / moveBack), when the screen shakes and whether the target is shown
// hurt. Plain functions on plain data, no engine import, so the scene only has to carry the plan out.

export type Cell = [number, number]; // a grid cell: the screen is 80 by 80 of them (SkillAct.gridSizeX / gridSizeY)

export interface Fx {
  t: [string, string, number, string, number][]; // unique effect rows: anime_user_atk, anime_res, shake_id, hit_action ("hurt" | "no-hurt"), split_hurt
  e: { [effectBid: string]: number }; // effect bid -> index into t
  g: { [group: string]: string }; // effect group (skill number // 10) -> attack animation
  s: { [shakeId: string]: [number, number, number] }; // strength, rounds, step in ms
  k?: { [effectBid: string]: [number, number, number] }; // black screen of an effect: delay (1/30 s), opacity 0..255, hides everyone but attacker and targets; absent in older releases
  nm?: { [skillBid: string]: string }; // the name of every active skill that is not a normal attack (the banner's text); absent in older releases
  n?: number[]; // the skills that are a hero's normal attack, which get no skill-name banner; absent in older releases
  m: { [model: string]: { [animeRes: string]: { [anim: string]: number[] } } }; // see MOVE_FIELDS; "0" is the default row
}

// the fields of a row of Fx.m
const MOVE_FIELDS = ["moveTime", "moveX", "moveY", "backDelay", "backTime", "backX", "moveDelay", "reverse", "area", "col", "map"] as const;
type MoveRow = { [k in typeof MOVE_FIELDS[number]]: number };

export interface EffectInfo { anim: string; animeRes: string; shakeId: number; noHurt: boolean; splitHurt: number }

const ACTIONS = ["action1", "action2", "action3", "action5"];
// a skill with no effect row or group (about one in seven of the server's skills): by its number, ...001 action1, ...101 action2, ...201 action3, ...301 action5
export const guessAction = (skillBid: number) => ACTIONS[Math.min(ACTIONS.length - 1, Math.floor((skillBid % 1000) / 100))];

// the black screen an effect brings (BattleModel.blackScreen2/3): the field darkens behind the fighters from `delay` seconds after the skill starts
// until the attacker is done; with `hideOthers` the fighters that are neither the attacker nor a target are not shown meanwhile
export function blackOf(fx: Fx, effectBids: number[]): { delay: number; alpha: number; hideOthers: boolean } | null {
  let found: { delay: number; alpha: number; hideOthers: boolean } | null = null;
  for (const bid of effectBids) {
    const k = fx.k?.[String(bid)];
    if (!k) continue;
    // the layer is shown once, so the first effect's opacity counts; any effect that hides the others does
    found = { delay: found ? found.delay : k[0] / 30, alpha: found ? found.alpha : k[1], hideOthers: (found?.hideOthers ?? false) || k[2] === 1 };
  }
  return found;
}

export function effectInfo(fx: Fx, effectBid: number): EffectInfo | null {
  const i = fx.e[String(effectBid)];
  if (i === undefined) return null;
  const [anim, animeRes, shakeId, hitAction, splitHurt] = fx.t[i];
  return { anim, animeRes, shakeId, noHurt: hitAction === "no-hurt", splitHurt: Math.max(1, splitHurt || 1) };
}

// what one hit of an effect whose damage is split into n hits shows (BattleModel.playMagic: math.ceil(hp_changed / split_hurt), so a loss of 100 in
// 3 hits is 33 each, three times; the target's hit points are then set to the server's after the last hit)
export const hitShare = (change: number, n: number): number => (n > 1 ? Math.ceil(change / n) : change);

// the event of an attack animation that lands the damage: "hit"; an animation without one (the area skills) has "attack", which the original
// takes as the damage point of an area effect, and a few have hit_big / hit_none (SkillAct.setAnimationWithEvent)
export function hitEvent(names: string[]): string | null {
  const have = names.map(n => n.toLowerCase());
  for (const n of ["hit", "hit_big", "hit_none", "hitevent1", "attack"]) if (have.indexOf(n) >= 0) return n;
  return null;
}

// the animation the attacker plays for a skill and its anime_res: that of the first of its effects naming one (the server lists them in
// effect_play), else that of its effect group (an empty one is "action2", as battle_model.lua does), else a guess by the skill number
export function attackOf(fx: Fx, skillBid: number, effectBids: number[]): { anim: string; animeRes: string } {
  for (const bid of effectBids) {
    const info = effectInfo(fx, bid);
    if (info?.anim) return { anim: info.anim, animeRes: info.animeRes };
  }
  return { anim: fx.g[String(Math.floor(skillBid / 10))] ?? guessAction(skillBid), animeRes: "" };
}

// the run of a model for an animation it plays (frames are 1/60 s, the delays 1/30 s, as SkillAct has them): the model's row, its anime_res, then
// the animation's own entry, falling back to action1 and finally to the default row, the way the original looks it up
export interface MovePlan { delay: number; time: number; x: number; y: number; area: boolean; col: boolean; reverse: boolean; backDelay: number; backTime: number; backX: number }

export function movePlan(fx: Fx, model: string, animeRes: string, anim: string): MovePlan {
  const base = fx.m["0"].action1.action1;
  const byRes = (fx.m[model] ?? fx.m["0"])[animeRes] ?? fx.m["0"].action1;
  const row = byRes[anim] ?? byRes.action1 ?? base;
  const p = {} as MoveRow;
  MOVE_FIELDS.forEach((k, i) => { p[k] = row[i] ?? 0; });
  return {
    delay: p.moveDelay / 30, time: p.moveTime / 60, x: p.moveX, y: p.moveY, area: p.area === 1, col: p.col === 1, reverse: p.reverse === 1,
    backDelay: p.backDelay / 30, backTime: p.backTime / 60, backX: p.backX,
  };
}

// where the attacker runs to, in grid cells. side is +1 for the first group and -1 for the second (obj_type). `home` is its own cell, `target` the
// cell of the first enemy it hits, `row` its row 1..3 (its y: 15, 21, 27).
export function moveTarget(p: MovePlan, side: number, home: Cell, target: Cell, row: number): Cell {
  const sign = p.reverse ? -1 : 1;
  if (p.area) return [40 + p.x * side, 80 * 11 / 36 + p.y]; // the middle of the field (moveToArea: SCREEN_WIDTH * 32 / 64, SCREEN_HEIGHT * 11 / 36)
  if (p.col) return [(side === 1 ? 34 : 44) + p.x * side * sign, [15, 21, 27][Math.max(1, Math.min(3, row)) - 1]]; // the fixed cells of its row
  if (p.x > 0) return [home[0] + p.x * side * sign, home[1] + p.y * side * sign]; // forward from where it stands
  return [target[0] + p.x * side * sign, target[1] + p.y]; // short of the target
}

// where it runs back to: its own cell, or short of the target by backX when that is above 0 (moveBack)
export function backTarget(p: MovePlan, side: number, home: Cell, target: Cell): Cell {
  return p.backX > 0 ? [target[0] - p.backX * side, target[1]] : home;
}

// the screen shake of a shake id, as BattleSceneNewView.shakeScreen steps it: each step is an offset of the whole field and the time to stay at it
const SHAKE_ORDER = [1, 4, 7, 8, 9, 6, 3, 2];
const SHAKE_DIR: Cell[] = [[-0.7, 0.7], [0, 1], [0.7, 0.7], [-1, 0], [0, 0], [1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];

export function shakeSteps(fx: Fx, shakeId: number): { x: number; y: number; wait: number }[] {
  const s = fx.s[String(shakeId)];
  if (!s) return [];
  const out: { x: number; y: number; wait: number }[] = [];
  let strength = s[0];
  for (let round = 0; round < s[1]; round++) {
    for (const k of SHAKE_ORDER) {
      const [dx, dy] = SHAKE_DIR[k - 1];
      out.push({ x: strength * 0.25 * dx, y: -strength * 0.25 * dy, wait: s[2] / 1000 });
    }
    strength -= 3;
  }
  return out;
}

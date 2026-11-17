// The effect models of a skill (tables/skill_fx_res.json, from pipeline/skill_fx_res_table.py): an effect row names lists of effect entities, each
// entity a Spine model drawn over and / or under the fighters, played once and removed. Where one goes follows the original's
// BattleModel.effectSpineUser / playHitEffect / effectArea: play_type 1 on the caster, 5 on the target, 2 the middle of the screen, 3 the caster's
// side of the field, 4 the enemy's side.
import { Director, Node, UITransform, Vec3, director, sp, tween } from "cc";
import { hasFile } from "./cdn";
import { playSpine, setModel, spineData } from "./spine";
import { W, H } from "./design";
import { fxOf } from "./skilltune";
import { fieldEffectPosition, projectilePath } from "./skillplan";

// res_up, res_down, up_action, down_action, play_type, scale (thousandths), h_scale, x_fix, y_fix, is_front, is_col_effect, spec_res_up
type Entity = [string, string, string, string, number, number, number, number, number, number, number, string];
export interface FxRes { l: { [effectBid: string]: number[][] }; r: { [entity: string]: Entity } }

// the lists of an effect row, in the table's order
export const FxList = { ready: 0, attack: 1, area: 2, hit: 3, hurt: 4, trace: 5 } as const;

export function entitiesOf(t: FxRes, effectBids: number[], list: number): number[] {
  const out = new Set<number>();
  for (const bid of effectBids) for (const id of t.l[String(bid)]?.[list] ?? []) out.add(id);
  return Array.from(out);
}

export interface FxSpot { root: Node; above: Node; below: Node; side: number; height: number; row: number; timeScale: number } // the original renderer has separate bottom/body/top children
export interface FxLayers { above: Node; below: Node }

function resource(res: string, action: string): { base: string; own: boolean } | null {
  if (!res) return null;
  const own = hasFile(`spine/fx/${res}/${action}.json`);
  const base = `spine/fx/${res}/${own ? action : "action"}`;
  return hasFile(`${base}.json`) ? { base, own } : null;
}

export function effectResources(t: FxRes, bids: number[], side: number): string[] {
  const bases = new Set<string>();
  for (const list of Object.values(FxList)) for (const id of entitiesOf(t, bids, list)) {
    const r = t.r[String(id)];
    if (!r) continue;
    for (const [res, action] of [[side === 1 && r[11] ? r[11] : r[0], r[2]], [r[1], r[3]]]) {
      const ref = resource(res, action || "action");
      if (ref) bases.add(ref.base);
    }
  }
  return Array.from(bases);
}

async function model(res: string, action: string, parent: Node, isCurrent?: () => boolean): Promise<{ n: Node; s: sp.Skeleton; anim: string } | null> {
  if (isCurrent?.() === false) return null;
  const ref = resource(res, action);
  if (!ref) return null;
  const n = new Node(`fx_${res}`);
  n.layer = parent.layer;
  n.addComponent(UITransform);
  const s = n.addComponent(sp.Skeleton);
  try {
    const data = await spineData(ref.base);
    if (!parent.isValid || isCurrent?.() === false) { n.destroy(); return null; }
    setModel(s, data);
  } catch (e) { n.destroy(); console.warn(`skill fx ${res}: ${(e as Error).message}`); return null; }
  const anims = Object.keys((s.skeletonData.skeletonJson as { animations?: object } | null)?.animations ?? {});
  const anim = s.findAnimation(action) ? action : ref.own || (isCurrent && anims.length === 1) ? anims[0] : "";
  if (!anim) { n.destroy(); return null; }
  parent.addChild(n);
  return { n, s, anim };
}

// one model played once at a place and then removed; a model the release lacks is skipped. The action names the animation and, for most models,
// the file it is in (action, action1, ...), as SpineRenderer.New(position, res, scale, loop, action) does; a model with the one file "action"
// keeps all its animations there (E80170's action1 and action2), so that file is looked in when the model has none of the action's name
async function once(res: string, action: string, parent: Node, x: number, y: number, scale: number, flip: number, isCurrent?: () => boolean, timeScale = 1): Promise<void> {
  const found = await model(res, action, parent, isCurrent);
  if (!found) return;
  const { n, s, anim } = found;
  n.setPosition(x, y, 0);
  n.setScale(flip * scale, scale, 1);
  s.timeScale = timeScale;
  s.setCompleteListener(() => { if (n.isValid) n.destroy(); });
  playSpine(s, anim);
}

export interface Flight { done: Promise<void>; cancel(): void }

// flyItem is launched by the actor's attack event; the hit callback belongs to arrival,
// not to the actor's hit event. Cancellation also settles the promise when leaving a preview.
export function flyEntity(t: FxRes, id: number, args: (number | string)[], caster: FxSpot, target: FxSpot, layer: Node, multiple: boolean, arrive: () => void, isCurrent: () => boolean): Flight {
  let finish!: () => void;
  let cancelled = false;
  let remove = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  const cancel = () => { cancelled = true; remove(); finish(); };
  const current = () => !cancelled && isCurrent();
  void (async () => {
    const r = t.r[String(id)];
    if (!r || !current()) { finish(); return; }
    const found = await model(caster.side === 1 && r[11] ? r[11] : r[0], r[2] || "action", layer, current);
    if (!found) { finish(); return; }
    const { n, s, anim } = found;
    const a = caster.root.position, b = target.root.position;
    const path = projectilePath([a.x, a.y], [b.x, b.y], caster.side, caster.height, target.height, r[7], r[8], args, multiple);
    n.setPosition(path.from[0], path.from[1], 0);
    n.setScale(caster.side * r[5] / 1000, r[5] / 1000, 1);
    n.angle = path.angle;
    s.timeScale = caster.timeScale;
    playSpine(s, anim, true);
    const flight = tween(n).delay(path.delay).to(path.seconds, { position: new Vec3(path.to[0], path.to[1], 0) }).call(() => {
      if (current()) arrive();
      cancel();
    });
    // A just-created tween must not consume the frame spent loading its own texture.
    const start = () => { if (current()) flight.start(); else cancel(); };
    remove = () => {
      director.off(Director.EVENT_BEFORE_UPDATE, start);
      flight.stop();
      if (n.isValid) { n.removeFromParent(); n.destroy(); }
    };
    if (!current()) { cancel(); return; }
    director.once(Director.EVENT_BEFORE_UPDATE, start);
  })().catch(e => { console.warn(`skill projectile ${id}: ${(e as Error).message}`); cancel(); });
  return { done, cancel };
}

// Which of an entity's play types each list plays (BattleModel.attackReady / attackPoint / playSceneAreaEffect / playHurtEffect): the ready list plays
// the ones on the caster (1) and on the field (3, 4), the attack list only those on the caster, the area list those on the field (2, 3, 4), and the
// hit list every one, on the target
export function playEntity(t: FxRes, id: number, list: number, caster: FxSpot, target: FxSpot | undefined, layers: FxLayers, isCurrent?: () => boolean): void {
  const r = t.r[String(id)];
  if (!r) return;
  const [normalUp, down, upAct, downAct, type, scale, , xFix, yFix, , column, specialUp] = r;
  const up = caster.side === 1 && specialUp ? specialUp : normalUp;
  const tuned = fxOf(id); // the hand correction of this entity: moved, scaled, started later
  const dir = caster.side, k = (scale === 0 ? 1 : scale * 0.001) * tuned.scale;
  const later = (f: () => void) => { if (tuned.delay > 0) setTimeout(() => { if (isCurrent?.() !== false) f(); }, tuned.delay * 1000); else f(); };
  const at = (spot: FxSpot, percentHeight: boolean) => {
    // on a fighter: over it at y_fix (the top of the model when 0; a hit effect takes y_fix as a percent of the height, 50 when 0), under it at its feet
    const upY = (percentHeight ? (yFix || 50) / 100 * spot.height : (yFix === 0 ? spot.height - 15 : yFix)) + tuned.dy;
    later(() => {
      void once(up, upAct || "action", spot.above, (xFix + tuned.dx) * dir, upY, k, scale === 0 ? 1 : dir, isCurrent, caster.timeScale);
      void once(down, downAct || "action", spot.below, (xFix + tuned.dx) * dir, tuned.dy, k, scale === 0 ? 1 : dir, isCurrent, caster.timeScale);
    });
  };
  const field = () => {
    const [baseX, baseY] = fieldEffectPosition(type, dir, caster.row, column === 1, xFix, yFix, W, H);
    const x = baseX + tuned.dx * dir, y = baseY + tuned.dy;
    later(() => {
      void once(up, upAct || "action", layers.above, x, y, tuned.scale, dir, isCurrent, caster.timeScale);
      void once(down, downAct || "action", layers.below, x, y, tuned.scale, dir, isCurrent, caster.timeScale);
    });
  };
  if (list === FxList.hit) { if (target) at(target, true); }
  else if (list === FxList.attack) { if (type === 1) at(caster, true); }
  else if (list === FxList.area) { if (type === 2 || type === 3 || type === 4) field(); }
  else if (list === FxList.ready) { if (type === 1) at(caster, false); else if (type === 3 || type === 4) field(); }
}

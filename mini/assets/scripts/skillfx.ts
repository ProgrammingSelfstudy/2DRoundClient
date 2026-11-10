// The effect models of a skill (tables/skill_fx_res.json, from pipeline/skill_fx_res_table.py): an effect row names lists of effect entities, each
// entity a Spine model drawn over and / or under the fighters, played once and removed. Where one goes follows the original's
// BattleModel.effectSpineUser / playHitEffect / effectArea: play_type 1 on the caster, 5 on the target, 2 the middle of the screen, 3 the caster's
// side of the field, 4 the enemy's side.
import { Node, UITransform, sp } from "cc";
import { hasFile } from "./cdn";
import { spineData } from "./spine";
import { W, H } from "./loginpage";

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

export interface FxSpot { root: Node; side: number; height: number } // a fighter: its position node, +1 or -1 for the way it faces, its model's height
export interface FxLayers { above: Node; below: Node }

// one model played once at a place and then removed; a model the release lacks is skipped. The action names both the file (action, action1, ...)
// and the animation in it, as SpineRenderer.New(position, res, scale, loop, action) does
async function once(res: string, action: string, parent: Node, x: number, y: number, scale: number, flip: number): Promise<void> {
  const base = `spine/fx/${res}/${action}`;
  if (!res || !hasFile(`${base}.json`)) return;
  const n = new Node(`fx_${res}`);
  n.layer = parent.layer;
  n.addComponent(UITransform);
  const s = n.addComponent(sp.Skeleton);
  try { s.skeletonData = await spineData(base); } catch (e) { console.warn(`skill fx ${res}: ${(e as Error).message}`); return; }
  if (!parent.isValid) return;
  s.premultipliedAlpha = false;
  n.setPosition(x, y, 0);
  n.setScale(flip * scale, scale, 1);
  parent.addChild(n);
  const anims = Object.keys((s.skeletonData.skeletonJson as { animations?: object } | null)?.animations ?? {});
  const anim = s.findAnimation(action) ? action : anims[0];
  if (!anim) { n.destroy(); return; }
  s.setCompleteListener(() => { if (n.isValid) n.destroy(); });
  s.setAnimation(0, anim, false);
}

// Which of an entity's play types each list plays (BattleModel.attackReady / attackPoint / playSceneAreaEffect / playHurtEffect): the ready list plays
// the ones on the caster (1) and on the field (3, 4), the attack list only those on the caster, the area list those on the field (2, 3, 4), and the
// hit list every one, on the target
export function playEntity(t: FxRes, id: number, list: number, caster: FxSpot, target: FxSpot | undefined, layers: FxLayers): void {
  const r = t.r[String(id)];
  if (!r) return;
  const [up, down, upAct, downAct, type, scale, , xFix, yFix] = r;
  const dir = caster.side, k = scale * 0.001;
  const at = (spot: FxSpot, isTarget: boolean) => {
    // on a fighter: over it at y_fix (the top of the model when 0; a hit effect takes y_fix as a percent of the height, 50 when 0), under it at its feet
    const upY = isTarget ? (yFix || 50) / 100 * spot.height : (yFix === 0 ? spot.height - 15 : yFix);
    void once(up, upAct || "action", spot.root, xFix * dir, upY, k, dir);
    void once(down, downAct || "action", spot.root, xFix * dir, 0, k, dir);
  };
  const field = () => {
    // the middle (2), or the casting side (3) or the other (4) at 22 or 78 percent of the width, a quarter up
    const mine = caster.side === 1;
    const x = type === 2 ? W / 2 : ((type === 3) === mine ? W * 0.22 : W * 0.78) + xFix * dir;
    const y = H / 4 + yFix;
    void once(up, upAct || "action", layers.above, x, y, k, dir);
    void once(down, downAct || "action", layers.below, x, y, k, dir);
  };
  if (list === FxList.hit) { if (target) at(target, true); }
  else if (list === FxList.attack) { if (type === 1) at(caster, false); }
  else if (list === FxList.area) { if (type === 2 || type === 3 || type === 4) field(); }
  else if (list === FxList.ready) { if (type === 1) at(caster, false); else if (type === 3 || type === 4) field(); }
}

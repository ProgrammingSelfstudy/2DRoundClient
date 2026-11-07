// The battle scene's opening frame, from the server's 20027 (who stands where): the stage's two background layers and every fighter's Spine
// stand animation at its grid cell. The grid is the original's (SkillAct.Pos2GridLeft / NormalPosGridRight; a cell is 1/80 of the design
// width and height, the role layer sits 300 above the bottom). Attacks (20004), hit points and results come later.
import { Node, Sprite, UITransform } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { spineNode } from "./spine";
import { W, H } from "./loginpage";
import type { Msg } from "./shared/proto/codec";

interface Models { p: { [bidStar: string]: string }; u: { [unit: string]: [string, number] } }

// my side by position 1..11, and the enemies of a normal (campaign) battle by position - 9 (1..9, then 10)
const LEFT: number[][] = [[27, 15], [28, 21], [29, 27], [17, 15], [18, 21], [19, 27], [7, 15], [8, 21], [9, 27], [15, 43], [11, 39]];
const RIGHT_NORMAL: number[][] = [[42, 15], [42, 21], [42, 27], [42, 15], [42, 21], [42, 27], [42, 15], [42, 21], [42, 27], [42, 43]];
const ROLE_LAYER_Y = 300, FAR_Y = 736, GROUND_Y = 40;
const OBJECT_PARTNER = 2, OBJECT_UNIT = 3; // BattleObjectType; the elf (5) and the hallows come later

export interface BattleScene { root: Node; start(opening: Msg, mapId: number): Promise<void>; show(on: boolean): void; onTap(f: () => void): void }

// the grid cell of a fighter: the original folds the two elf positions onto 10 and 11, and the second group counts from 10
function cell(group: number, pos: number): number[] {
  if (group === 1) return LEFT[(pos === 31 || pos === 32 ? 10 : pos === 41 || pos === 42 ? 11 : pos) - 1];
  return RIGHT_NORMAL[Math.max(1, pos - 9) - 1];
}

export async function buildBattleScene(canvas: Node): Promise<BattleScene> {
  const models = await loadJson<Models>("tables/battle_models.json");
  const root = new Node("battle_scene");
  root.layer = canvas.layer;
  root.addComponent(UITransform).setContentSize(W, H);
  root.setPosition(-W / 2, -H / 2, 0);
  root.active = false;
  canvas.addChild(root);
  const layer = (name: string, x: number, y: number) => {
    const n = new Node(name);
    n.layer = root.layer;
    const ut = n.addComponent(UITransform);
    ut.setAnchorPoint(0, 0);
    n.setPosition(x, y, 0);
    root.addChild(n);
    return n;
  };
  const far = layer("far", 0, FAR_Y), ground = layer("ground", 0, GROUND_Y), roles = layer("roles", 0, ROLE_LAYER_Y);
  let tapped = () => {};
  root.on(Node.EventType.TOUCH_END, () => tapped());
  let token = 0;

  const picture = async (parent: Node, logical: string) => {
    const s = parent.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.RAW;
    try { s.spriteFrame = await spriteFrame(logical); } catch (e) { console.warn(`battle scene: ${(e as Error).message}`); }
  };

  return {
    root,
    show(on) { root.active = on; },
    onTap(f) { tapped = f; },
    async start(opening, mapId) {
      const mine = ++token;
      roles.removeAllChildren();
      far.removeComponent(Sprite);
      ground.removeComponent(Sprite);
      await Promise.all([picture(far, `bg/battle/${mapId}/m_bg.webp`), picture(ground, `bg/battle/${mapId}/map_bg.webp`)]);
      for (const o of opening.objects as Msg[]) {
        const type = Number(o.object_type), group = Number(o.group), bid = Number(o.object_bid);
        const model = type === OBJECT_PARTNER ? models.p[`${bid}_${o.star}`] : type === OBJECT_UNIT ? models.u[String(bid)]?.[0] : undefined;
        if (!model) continue;
        const [gx, gy] = cell(group, Number(o.pos));
        const size = type === OBJECT_UNIT ? (models.u[String(bid)]?.[1] ?? 1000) / 1000 : 1;
        try {
          const sk = await spineNode(`spine/hero/${model}/stand2`, "stand2", roles);
          if (mine !== token) return sk.node.destroy(); // a newer fight began while this one loaded
          sk.node.setPosition(gx * (W / 80), gy * (H / 80), 0);
          sk.node.setScale(group === 1 ? size : -size, size, 1); // the second group faces the first
        } catch (e) { console.warn(`battle scene: ${model}: ${(e as Error).message}`); }
      }
    },
  };
}

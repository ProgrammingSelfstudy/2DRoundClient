// The main-line stage page: the original's `battle/battle_button_list` panel (stage name, the hook rewards, the boss button), filled from
// the server's 13000 (current stage and its state) and the stage table. The city scene stays behind it as the sea map; the stage map, the
// boss picture, fighting and the quick-battle window come later.
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout } from "./ui";
import { W, H } from "./loginpage";
import type { Msg } from "./shared/proto/codec";

// id -> [name, unit id, shown rewards [item, count], per-minute rewards [item, count], level limit, next stage], from tables/dungeons.json
type StageTable = { [id: string]: [string, number, number[][], number[][], number, number, number[][]] };
type ItemTable = { [id: string]: [string, number, number, number] };
// what the boss button asks for: "next" goes to the next chapter (status 3), "fight" challenges the boss, "level" is short of the level limit
export type BossAction = "next" | "fight" | "level";
export interface DramaPage { root: Node; setDrama(d: Msg | undefined, roleLev: number): void; show(on: boolean): void; onBoss(f: (a: BossAction) => void): void; onQuick(f: () => void): void; maxDunId(): number }

const FIRST_STAGE = 10010; // what the original shows before anything has been passed (max_dun_id 0)

export async function buildDramaPage(canvas: Node): Promise<DramaPage> {
  const [layout, stages, items, models] = await Promise.all([
    loadJson<LNode>("layouts/battle/battle_button_list.json"),
    loadJson<StageTable>("tables/dungeons.json"),
    loadJson<ItemTable>("tables/items.json"),
    loadJson<{ b: { [unit: string]: number } }>("tables/battle_models.json"), // b: stage unit -> head_icon of its boss
  ]);
  const built = await buildLayout(layout, canvas, { hide: ["encounter_btn", "next_battle_time", "tips"] });
  const by = built.byName;
  const root = built.root;
  root.setPosition(-W / 2, -H / 2 + 108 - 65, 0); // root_wnd's bottom sits above the bottom bar (the original: -bottom height - 65, anchored bottom-centre)
  root.active = false;
  // behind the panel the original runs its hook battle on the chapter's map (BattleHookModel); here the map's two layers are laid the way the battle
  // scene lays them (far layer 736 up, ground 40 up), with nothing fighting on them yet. Only the first chapter's map is in the release.
  const MAP_ID = 10008; // the first chapter (data_drama_world_info), as boot.ts passes to the fight
  const backdrop = new Node("hook_scene");
  backdrop.layer = canvas.layer;
  backdrop.addComponent(UITransform).setContentSize(W, H);
  backdrop.getComponent(UITransform)!.setAnchorPoint(0, 0);
  backdrop.setPosition(-W / 2, -H / 2, 0);
  backdrop.active = false;
  canvas.addChild(backdrop);
  backdrop.setSiblingIndex(root.getSiblingIndex()); // under the panel, over the city scene
  for (const [name, y] of [["m_bg", 736], ["map_bg", 40]] as const) {
    const n = new Node(name);
    n.layer = canvas.layer;
    n.addComponent(UITransform).setAnchorPoint(0, 0);
    n.setPosition(0, y, 0);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.RAW;
    spriteFrame(`bg/battle/${MAP_ID}/${name}.webp`).then(f => { if (sp.isValid) sp.spriteFrame = f; }, e => console.warn(`stage map ${name}:`, (e as Error).message));
    backdrop.addChild(n);
  }
  const text = (n: string) => by.get(n)?.getComponent(Label);
  const label = (parent: Node, str: string, x: number, y: number, size: number, color: Color) => {
    const n = new Node("label");
    n.layer = parent.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(180, size + 8);
    ut.setAnchorPoint(0, 0.5); // x is the text's left edge
    const l = n.addComponent(Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = HorizontalTextAlignment.LEFT;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.color = color;
    l.enableOutline = true;
    l.outlineColor = new Color(17, 17, 17, 255);
    l.outlineWidth = 2;
    n.setPosition(x, y, 0);
    parent.addChild(n);
    return l;
  };
  // the description is a Text of the layout's scroll_view; the layout has none, so it is added: the original shows "《ONE PIECE》" when the stage has none
  const desc = by.get("scroll_view")!;
  const descLabel = label(desc, "《ONE PIECE》", -desc.getComponent(UITransform)!.width / 2 + 5, -12, 20, new Color(81, 55, 59, 255));
  descLabel.node.getComponent(UITransform)!.setContentSize(330, 110);

  const rewardLayout = by.get("reward_layout")!;
  const hook: Node[] = []; // what the last fill added to the reward column
  const scroll = by.get("item_scrollview")!;
  const icons: Node[] = [];
  // the shown rewards sit in a clipped strip that drags sideways when they do not fit
  scroll.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const strip = new Node("strip");
  strip.layer = scroll.layer;
  strip.addComponent(UITransform).setContentSize(0, 0);
  scroll.addChild(strip);
  let minX = 0;
  scroll.on(Node.EventType.TOUCH_MOVE, (e: { getUIDelta(): { x: number } }) => {
    strip.setPosition(Math.min(0, Math.max(minX, strip.position.x + e.getUIDelta().x)), 0, 0);
  });

  const addItem = (id: number, count: number, parent: Node, x: number, y: number, size: number, withCount: boolean) => {
    const n = new Node(`item_${id}`);
    n.layer = parent.layer;
    n.addComponent(UITransform).setContentSize(size, size);
    const s = n.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    const row = items[String(id)];
    if (row) spriteFrame(`icons/item/${row[1]}.webp`).then(sf => { s.spriteFrame = sf; }, () => {});
    n.setPosition(x, y, 0);
    parent.addChild(n);
    if (withCount) label(n, String(count), size / 2 - 22, -size / 2 + 10, 18, new Color(255, 255, 255, 255));
    return n;
  };

  const bossPic = by.get("image_boss")!;
  const boss = by.get("guildsign_battle_boss_btn")!;
  const bossNotice = text("notice_label")!;
  const bossChallenge = by.get("challenge_item")!;
  by.get("guidesign_battle_quick_btn")!.getChildByName("tips")!.active = false;

  const fill = (stageId: number) => {
    const st = stages[String(stageId)] ?? stages[String(FIRST_STAGE)];
    text("title_pass")!.string = st[0];
    descLabel.string = "《ONE PIECE》";
    const head = models.b[String(st[1])];
    if (head !== undefined) {
      let sp = bossPic.getComponent(Sprite);
      if (!sp) { sp = bossPic.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; } // the layout's picture has no texture, so no Sprite was built
      const pic = sp;
      spriteFrame(`icons/head/b${head}.webp`).then(sf => { if (bossPic.isValid) pic.spriteFrame = sf; }, () => {}); // a boss with no picture keeps the layout's
    }
    hook.forEach(n => n.destroy());
    hook.length = 0;
    // per-minute hook rewards, listed from the bottom up as "<icon> N/m"
    st[3].forEach(([id, n], i) => {
      const row = items[String(id)];
      const y = 2 + i * 40 + 17; // the original's rich label sits at (13, i * 40 + 2) with its origin bottom-left
      if (row) {
        const ic = new Node("icon");
        ic.layer = rewardLayout.layer;
        ic.addComponent(UITransform).setContentSize(30, 30);
        const s = ic.addComponent(Sprite);
        s.sizeMode = Sprite.SizeMode.CUSTOM;
        spriteFrame(`icons/item/${row[1]}.webp`).then(sf => { s.spriteFrame = sf; }, () => {});
        ic.setPosition(27, y, 0);
        rewardLayout.addChild(ic);
        hook.push(ic);
      }
      const l = label(rewardLayout, `${n}/m`, 46, y, 20, new Color(255, 255, 255, 255));
      hook.push(l.node);
    });
    icons.forEach(n => n.destroy());
    icons.length = 0;
    // the shown rewards in the scroll view, at half size with 10 between
    const w = scroll.getComponent(UITransform)!;
    st[2].forEach(([id, n], i) => {
      icons.push(addItem(id, n, strip, 5 + 30 + i * (60 + 10), w.height / 2, 60, true));
    });
    minX = Math.min(0, w.width - (st[2].length * 70 + 5));
    strip.setPosition(0, 0, 0);
  };

  let action: BossAction = "fight";
  let handler = (_a: BossAction) => {};
  boss.on(Node.EventType.TOUCH_END, () => handler(action));
  let quickHandler = () => {};
  by.get("guidesign_battle_quick_btn")!.on(Node.EventType.TOUCH_END, () => quickHandler());
  let maxDun = 0; // max_dun_id of the last 13000/13001: the quick battle window lists the drops of that stage

  return {
    root,
    show(on) { root.active = on; backdrop.active = on; },
    onBoss(f) { handler = f; },
    onQuick(f) { quickHandler = f; },
    maxDunId() { return maxDun; },
    setDrama(d, roleLev) {
      const maxId = Number(d?.max_dun_id ?? 0);
      maxDun = maxId;
      fill(maxId === 0 ? FIRST_STAGE : Number(d?.dun_id ?? FIRST_STAGE));
      // status 2 with no cool-down: the boss can be challenged (or needs a level); 3: this chapter is done; 1 with a cool-down: waiting
      const status = Number(d?.status ?? 0), cool = Number(d?.cool_time ?? 0);
      const st = stages[String(d?.dun_id ?? FIRST_STAGE)];
      const need = st?.[4] ?? 0;
      boss.active = (status === 2 && cool === 0) || status === 3;
      by.get("next_battle_time")!.active = status === 1 && cool !== 0;
      if (status === 3) {
        action = "next";
        bossNotice.node.active = true; bossChallenge.active = false; bossNotice.string = "前往下一章";
      } else if (need > roleLev) {
        action = "level";
        bossNotice.node.active = true; bossChallenge.active = false; bossNotice.string = `${need}级可挑战`;
      } else {
        action = "fight";
        bossNotice.node.active = false; bossChallenge.active = true;
      }
    },
  };
}

// The quick battle window: the original `battledrama/battle_drama_quick_battle_windows`, opened by the stage page's quick button. It lists what the
// newest passed stage drops (data_drama_dungeon_info quick_show_items), says how many quick battles are left today (13006) and sends 13004.
// Left out for now: the privilege count and the paid confirmation, the explain tip, and the energy-overflow alert.
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, blockInput } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";
import type { Msg } from "./shared/proto/codec";

type StageTable = { [id: string]: [string, number, number[][], number[][], number, number, number[][]] };
type ItemTable = { [id: string]: [string, number, number, number] };
export interface QuickWindow { root: Node; open(maxDunId: number, quick: Msg): void; setQuick(quick: Msg): void; onQuick(f: () => void): void; close(): void }

const HOOK_MINUTES = 120; // BattleDramaModel.hook_max_time when the server has not said otherwise
const CELL = 119, GAP = 30, START_X = 22, ROW_H = 129; // CommonScrollViewLayout: 4 columns, item 119, space_x 30, space_y 10

export async function buildQuickWindow(canvas: Node): Promise<QuickWindow> {
  const [layout, stages, items] = await Promise.all([
    loadJson<LNode>("layouts/battledrama/battle_drama_quick_battle_windows.json"),
    loadJson<StageTable>("tables/dungeons.json"),
    loadJson<ItemTable>("tables/items.json"),
  ]);
  const built = await buildLayout(layout, canvas, { hide: ["source_btn", "holid_up", "btn_buy_quick", "desc"] });
  const by = built.byName;
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  blockInput(root, W, H);
  root.active = false;
  const main = by.get("root")!;
  const text = (parent: Node, str: string, x: number, y: number, size: number, color: Color, ax = 0.5, ay = 0.5, w = 300, h = size + 8, wrap = false) => {
    const n = new Node("label");
    n.layer = parent.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(w, h);
    ut.setAnchorPoint(ax, ay);
    const l = n.addComponent(Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = ax === 0 ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.CENTER;
    l.verticalAlign = ay === 1 ? VerticalTextAlignment.TOP : VerticalTextAlignment.CENTER;
    l.overflow = wrap ? Label.Overflow.RESIZE_HEIGHT : Label.Overflow.NONE;
    l.color = color;
    n.setPosition(x, y, 0);
    parent.addChild(n);
    return l;
  };
  const OX = -360, OY = -640; // the layout's positions have the bottom-left as origin; `root` is a 720x1280 panel anchored in its middle
  const dark = new Color(81, 55, 59, 255), green = new Color(36, 144, 3, 255), white = new Color(255, 255, 255, 255);

  // the girl of the layout is bigbg_50, loaded by the layout's own `image` path; the window closes on the dim background or the close button
  let close = () => {};
  by.get("background")!.on(Node.EventType.TOUCH_END, () => close());
  by.get("close_btn")!.on(Node.EventType.TOUCH_END, () => close());
  by.get("explain_btn")!.active = false; // its tip text (data_drama_const game_rule) is not in the release yet

  text(main,`快速作战可获得${HOOK_MINUTES}分钟挂机收益。`, 236 + OX, 870 + OY, 24, dark, 0, 1, 410, 60, true);
  const count = text(main, "", 566 + OX, 426 + OY, 24, green, 0.5, 0.5, 175);

  // the quick battle button: createButton(... common_1017, 220x64) in the middle at y 426
  const btn = new Node("quick_btn");
  btn.layer = main.layer;
  btn.addComponent(UITransform).setContentSize(220, 64);
  const bs = btn.addComponent(Sprite);
  bs.sizeMode = Sprite.SizeMode.CUSTOM;
  atlasFrame("ui/common/common.json", "common_1017.png", [17, 17, 24, 17]).then(sf => { bs.spriteFrame = sf; }, () => {});
  btn.setPosition(360 + OX, 426 + OY, 0);
  main.addChild(btn);
  const btnLabel = text(btn, "快速作战", 0, 0, 26, white, 0.5, 0.5, 200);
  btnLabel.enableOutline = true;
  btnLabel.outlineColor = new Color(118, 69, 25, 255);
  btnLabel.outlineWidth = 2;
  let handler = () => {};
  btn.on(Node.EventType.TOUCH_END, () => handler());

  // the drops: a vertical strip in a clipped list_view that drags
  const list = by.get("list_view")!;
  const lh = list.getComponent(UITransform)!.height;
  list.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const strip = new Node("strip");
  strip.layer = list.layer;
  strip.addComponent(UITransform).setContentSize(0, 0);
  list.addChild(strip);
  const scroll = dragScroll(list, strip, "y");
  const fillDrops = (maxDunId: number, addMinutes: number) => {
    strip.removeAllChildren();
    const st = stages[String(maxDunId)];
    const shown = st?.[6] ?? [];
    shown.forEach(([id, n], i) => {
      const cell = new Node(`item_${id}`);
      cell.layer = list.layer;
      cell.addComponent(UITransform).setContentSize(CELL, CELL);
      const row = items[String(id)];
      const sp = cell.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (row) spriteFrame(`icons/item/${row[1]}.webp`).then(sf => { if (cell.isValid) sp.spriteFrame = sf; }, () => {});
      const col = i % 4, line = Math.floor(i / 4);
      cell.setPosition(START_X + CELL / 2 + col * (CELL + GAP) - list.getComponent(UITransform)!.width / 2, lh / 2 - 10 - CELL / 2 - line * ROW_H, 0);
      const num = n + Math.floor(n * addMinutes / HOOK_MINUTES); // the holiday bonus adds a share of the hook minutes
      text(cell, String(num), CELL / 2 - 8, -CELL / 2 + 16, 22, white, 1, 0.5, 100).enableOutline = true;
      strip.addChild(cell);
    });
    scroll.range(0, Math.max(0, Math.ceil(shown.length / 4) * ROW_H - lh));
    strip.setPosition(0, 0, 0);
  };

  let maxDun = 0;
  const setQuick = (q: Msg) => {
    const free = Number(q.fast_combat_free_num ?? 0), max = Number(q.fast_combat_max ?? 0), used = Number(q.fast_combat_num ?? 0);
    // 本次免费 while the day's free quick battle is unused (fast_combat_free_num > 0), else what is left of the day's count
    count.string = free > 0 ? "本次免费" : `今日剩余:${Math.max(0, max - used)}次`;
    fillDrops(maxDun, Number(q.fast_combat_add_time ?? 0));
  };
  close = () => { root.active = false; };
  return {
    root,
    open(maxDunId, q) { maxDun = maxDunId; setQuick(q); root.active = true; },
    setQuick,
    onQuick(f) { handler = f; },
    close,
  };
}

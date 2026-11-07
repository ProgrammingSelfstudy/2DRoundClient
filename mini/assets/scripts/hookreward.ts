// The reward window of a hook claim or a quick battle: the original `battledrama/battle_drama_hook_reward_windows` (BattlDramaHookRewardWindow), opened by
// the server's 13007. It shows the role's level, the exp bar filling from the old to the new exp, the time the reward covers and the items.
// Left out for now: the role's head picture in the frame, the title's Spine effect (278) and the items' quality frames.
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, blockInput } from "./ui";
import { W, H } from "./loginpage";
import type { Msg } from "./shared/proto/codec";

type ItemTable = { [id: string]: [string, number, number, number] };
export interface HookReward { root: Node; open(m: Msg): void; close(): void }

const CELL_W = 120, CELL_H = 145, START_X = 94, SPACE_X = 20, SPACE_Y = 10; // CommonScrollViewLayout: 4 columns, item 120x145
const BAR_W = 345; // progress_container's width

const clock = (sec: number) => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(v => String(v).padStart(2, "0")).join(":");

export async function buildHookReward(canvas: Node): Promise<HookReward> {
  const [layout, items, expMax] = await Promise.all([
    loadJson<LNode>("layouts/battledrama/battle_drama_hook_reward_windows.json"),
    loadJson<ItemTable>("tables/items.json"),
    loadJson<number[]>("tables/role_exp.json"), // exp_max of level 1, 2, ...
  ]);
  const built = await buildLayout(layout, canvas, { panelImages: true });
  const by = built.byName;
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  blockInput(root, W, H);
  root.active = false;
  const label = (name: string) => by.get(name)!.getComponent(Label)!;
  const bar = by.get("progress")!.getComponent(Sprite)!;
  const barKnob = by.get("progress_bar")!;
  const knobY = barKnob.position.y;

  // the item list: a clipped list_view whose strip drags
  const list = by.get("list_view")!;
  const lw = list.getComponent(UITransform)!.width, lh = list.getComponent(UITransform)!.height;
  // the layout puts list_view's top at y 604, over the "获得物品" title (y 532); the grid has to sit under the title, so its top goes to the title's lower edge
  list.setPosition(list.position.x, by.get("main_container")!.position.y + by.get("get_title")!.position.y - 12 - 12, 0); // title centre in root space, minus half its height and a gap
  list.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const strip = new Node("strip");
  strip.layer = list.layer;
  strip.addComponent(UITransform).setContentSize(0, 0);
  list.addChild(strip);
  let minY = 0;
  list.on(Node.EventType.TOUCH_MOVE, (e: { getUIDelta(): { y: number } }) => {
    strip.setPosition(0, Math.max(0, Math.min(minY, strip.position.y + e.getUIDelta().y)), 0);
  });
  const text = (parent: Node, str: string, y: number, size: number, color: Color, outline: boolean) => {
    const n = new Node("label");
    n.layer = parent.layer;
    n.addComponent(UITransform).setContentSize(CELL_W, size + 8);
    const l = n.addComponent(Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.SHRINK;
    l.color = color;
    if (outline) l.enableOutline = true;
    n.setPosition(0, y, 0);
    parent.addChild(n);
  };
  const fillItems = (rows: { bid: number; num: number }[]) => {
    strip.removeAllChildren();
    rows.forEach(({ bid, num }, i) => {
      const cell = new Node(`item_${bid}`);
      cell.layer = list.layer;
      cell.addComponent(UITransform).setContentSize(CELL_W, CELL_H);
      const row = items[String(bid)];
      const icon = new Node("icon");
      icon.layer = list.layer;
      icon.addComponent(UITransform).setContentSize(100, 100);
      const sp = icon.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (row) spriteFrame(`icons/item/${row[1]}.webp`).then(sf => { if (icon.isValid) sp.spriteFrame = sf; }, () => {});
      icon.setPosition(0, 25, 0); // BackPackItem at (60, 85) in a 120x145 cell
      cell.addChild(icon);
      text(cell, String(num), 0, 22, new Color(255, 255, 255, 255), true);
      text(cell, row?.[0] ?? "", -CELL_H / 2 + 14, 24, new Color(255, 232, 135, 255), false);
      const col = i % 4, line = Math.floor(i / 4);
      cell.setPosition(START_X + CELL_W / 2 + col * (CELL_W + SPACE_X) - lw / 2, -CELL_H / 2 - line * (CELL_H + SPACE_Y), 0); // list_view's anchor is (0.5, 1): y runs down from its top edge
      strip.addChild(cell);
    });
    minY = Math.max(0, Math.ceil(rows.length / 4) * (CELL_H + SPACE_Y) - SPACE_Y - lh);
    strip.setPosition(0, 0, 0);
  };

  const setBar = (pct: number, exp: number, max: number) => {
    bar.fillRange = pct / 100;
    barKnob.setPosition(pct * 0.01 * BAR_W + 5 - BAR_W / 2, knobY, 0);
    label("progress_val").string = `${exp}/${max}`;
  };
  // the exp bar fills 1% per 10 ms from the old exp, runs through full for each level gained, and stops at the new exp
  let timer: ReturnType<typeof setInterval> | undefined;
  const runBar = (oldLev: number, oldExp: number, newLev: number, newExp: number) => {
    clearInterval(timer);
    let lev = oldLev;
    let pct = oldExp / expMax[lev - 1] * 100;
    let end = lev === newLev ? newExp / expMax[lev - 1] * 100 : 100;
    setBar(pct, oldExp, expMax[lev - 1]);
    timer = setInterval(() => {
      pct += 1;
      if (pct < end) return setBar(pct, Math.round(pct * 0.01 * expMax[lev - 1]), expMax[lev - 1]);
      if (lev === newLev) {
        setBar(end, newExp, expMax[newLev - 1]);
        clearInterval(timer);
        return;
      }
      lev += 1;
      pct = 0;
      end = lev === newLev ? newExp / expMax[lev - 1] * 100 : 100;
    }, 10);
  };

  let canClose = false;
  const close = () => { clearInterval(timer); root.active = false; };
  const tryClose = () => { if (canClose) close(); };
  by.get("background")!.on(Node.EventType.TOUCH_END, tryClose);
  by.get("guidesign_rewards_quick_btn")!.on(Node.EventType.TOUCH_END, tryClose);
  return {
    root,
    open(m) {
      canClose = false;
      setTimeout(() => { canClose = true; }, 300); // the original ignores taps for the first 0.3 s
      label("time_title").string = Number(m.type) === 2 ? "快速作战：" : "挂机收益：";
      label("time_value").string = clock(Number(m.time ?? 0));
      const newLev = Number(m.new_lev ?? 1), oldLev = Number(m.old_lev ?? newLev);
      label("level").string = `LV.${newLev}`;
      const vip = by.get("guidesign_rewards_quick_btn")!.getChildByName("label")!.getComponent(Label)!;
      vip.string = Number(m.vip_buff ?? 0) === 0 ? "vip可获额外收益加成" : Number(m.honor_buff ?? 0) !== 0 ? "获得来自vip、称号的收益加成" : "获得来自vip的收益加成";
      fillItems((m.items ?? []) as { bid: number; num: number }[]);
      if (expMax[oldLev - 1] && expMax[newLev - 1]) runBar(oldLev, Number(m.old_exp ?? 0), newLev, Number(m.new_exp ?? 0));
      root.setSiblingIndex(root.parent!.children.length - 1);
      root.active = true;
    },
    close,
  };
}

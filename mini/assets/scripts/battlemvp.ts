// The win window of a campaign fight: the original `battle/battle_mvp_view` (BattleMvpView), opened by the server's 13016. It shows the MVP banner,
// the team's damage, the role's level and exp bar, the reward items and a confirm button that also fires after 10 seconds.
// Left out for now: the MVP hero's bust and name, the role's head, the effects (274, 275, 156), the damage statistics window, the "back to the mode"
// button and the "current fight" line.
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, blockInput } from "./ui";
import { dragScroll } from "./widgets";
import type { Msg } from "./shared/proto/codec";

type ItemTable = { [id: string]: [string, number, number, number] };
export interface MvpWindow { root: Node; open(m: Msg): Promise<void> }

const CELL = 119, SPACE_X = 20, SPACE_Y = 50; // BackPackItem is 119 square; 4 to a row, 50 between rows
const CLOSE_SECONDS = 10;

export async function buildMvpWindow(canvas: Node): Promise<MvpWindow> {
  const [layout, items, expMax] = await Promise.all([
    loadJson<LNode>("layouts/battle/battle_mvp_view.json"),
    loadJson<ItemTable>("tables/items.json"),
    loadJson<number[]>("tables/role_exp.json"),
  ]);
  const built = await buildLayout(layout, canvas, { hide: ["auto_combat_num", "harm_btn"] });
  const by = built.byName;
  const root = built.root;
  root.setPosition(-360, -640, 0);
  blockInput(root, 720, 1280);
  root.active = false;
  const container = by.get("container")!;
  by.get("pic_mvp")!.setPosition(0, 1155, 0); // the layout holds the end of the original's slide-in
  by.get("pic_bg")!.setPosition(0, 1010, 0);

  const text = (parent: Node, str: string, x: number, y: number, size: number, color: Color, ax = 0.5, ay = 0.5, w = 400) => {
    const n = new Node("label");
    n.layer = parent.layer;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(w, size + 8);
    ut.setAnchorPoint(ax, ay);
    const l = n.addComponent(Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = ax === 0 ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.NONE;
    l.color = color;
    n.setPosition(x, y, 0);
    parent.addChild(n);
    return l;
  };
  const gold = new Color(255, 232, 183, 255), white = new Color(255, 255, 255, 255);

  // the damage block on pic_bg (anchor left-middle): "总伤害输出" over the figure and its share of the team
  const picBg = by.get("pic_bg")!;
  const hurtTitle = text(picBg, "总伤害输出", 30, 38 - 70, 24, gold, 0, 0.5, 220);
  const hurtValue = text(picBg, "", 30, 5 - 70, 24, new Color(255, 129, 36, 255), 0, 0.5, 220);
  void hurtTitle;

  // the exp bar on sprite_3: a filled picture over the bar's back, the knob at its end, the numbers in the middle, "Lv.N" above its left end
  const barBack = by.get("sprite_3")!;
  const bw = 345, bh = 24;
  const fill = new Node("progress");
  fill.layer = barBack.layer;
  fill.addComponent(UITransform).setContentSize(bw, bh);
  fill.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
  const fs = fill.addComponent(Sprite);
  fs.sizeMode = Sprite.SizeMode.CUSTOM;
  fill.setPosition(-bw / 2, 0, 0);
  barBack.addChild(fill);
  // the filled type goes on after the picture is set: a filled sprite without its frame cannot compute its UVs
  atlasFrame("ui/battlemvp/battlemvp.json", "battlemvp_1004.png").then(sf => {
    fs.spriteFrame = sf;
    fs.type = Sprite.Type.FILLED;
    fs.fillType = Sprite.FillType.HORIZONTAL;
    fs.fillStart = 0;
    fs.fillRange = fillPct / 100;
  }, () => {});
  const knob = new Node("knob");
  knob.layer = barBack.layer;
  knob.addComponent(UITransform).setAnchorPoint(1, 0.5);
  const ks = knob.addComponent(Sprite);
  ks.sizeMode = Sprite.SizeMode.RAW;
  atlasFrame("ui/battlemvp/battlemvp.json", "battlemvp_1005.png").then(sf => { ks.spriteFrame = sf; }, () => {});
  barBack.addChild(knob);
  const barText = text(barBack, "", 0, 0, 18, white, 0.5, 0.5, bw);
  barText.enableOutline = true;
  barText.outlineColor = new Color(0, 0, 0, 255);
  barText.outlineWidth = 1;
  const levText = text(barBack, "", -bw / 2, bh / 2 + 14, 24, gold, 0, 0.5, 160);
  let fillPct = 0; // kept for the picture that arrives after the first setBar
  const setBar = (pct: number, exp: number, max: number) => {
    fillPct = pct;
    if (fs.type === Sprite.Type.FILLED) fs.fillRange = pct / 100;
    knob.setPosition(-bw / 2 + bw * pct / 100 + 2, 0, 0);
    barText.string = `${exp}/${max}`;
  };
  let barTimer: ReturnType<typeof setInterval> | undefined;
  const runBar = (lev0: number, exp0: number, lev1: number, exp1: number) => {
    clearInterval(barTimer);
    let lev = lev0;
    let pct = exp0 / expMax[lev - 1] * 100;
    let end = lev === lev1 ? exp1 / expMax[lev - 1] * 100 : 100;
    setBar(pct, exp0, expMax[lev - 1]);
    barTimer = setInterval(() => {
      pct += 1;
      if (pct < end) return setBar(pct, Math.ceil(expMax[lev - 1] * pct / 100), expMax[lev - 1]);
      if (lev === lev1) {
        setBar(end, exp1, expMax[lev1 - 1]);
        clearInterval(barTimer);
        return;
      }
      lev += 1;
      pct = 0;
      end = lev === lev1 ? exp1 / expMax[lev - 1] * 100 : 100;
    }, 10);
  };

  // the rewards: a clipped, draggable list under the container's top half
  const list = new Node("rewards");
  list.layer = root.layer;
  const lut = list.addComponent(UITransform);
  lut.setAnchorPoint(0, 0);
  lut.setContentSize(720, 240);
  list.setPosition(0, 382, 0);
  list.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  root.addChild(list);
  const strip = new Node("strip");
  strip.layer = root.layer;
  strip.addComponent(UITransform).setContentSize(0, 0);
  strip.setPosition(0, 240, 0); // the strip's origin is the list's top edge; children hang below it
  list.addChild(strip);
  const scroll = dragScroll(list, strip, "y");
  const fillRewards = (rows: { bid: number; num: number }[]) => {
    strip.removeAllChildren();
    const perRow = Math.min(4, rows.length);
    const startX = (720 - (perRow * CELL + (perRow - 1) * SPACE_X)) / 2;
    rows.forEach(({ bid, num }, i) => {
      const cell = new Node(`item_${bid}`);
      cell.layer = root.layer;
      cell.addComponent(UITransform).setContentSize(CELL, CELL);
      const row = items[String(bid)];
      const sp = cell.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (row) spriteFrame(`icons/item/${row[1]}.webp`).then(sf => { if (cell.isValid) sp.spriteFrame = sf; }, () => {});
      text(cell, String(num), CELL / 2 - 8, -CELL / 2 + 16, 22, white, 1, 0.5, 100).enableOutline = true;
      text(cell, row?.[0] ?? "", 0, -CELL / 2 - 16, 20, gold, 0.5, 0.5, CELL + SPACE_X);
      const col = i % 4, line = Math.floor(i / 4);
      cell.setPosition(startX + CELL / 2 + col * (CELL + SPACE_X) - 0, -20 - CELL / 2 - line * (CELL + SPACE_Y), 0);
      strip.addChild(cell);
    });
    const lines = Math.ceil(rows.length / 4);
    scroll.range(240, 240 + Math.max(0, lines * (CELL + SPACE_Y) + 20 - 240));
    // a single row sits in the middle of the list
    if (lines === 1) strip.children.forEach(c => c.setPosition(c.position.x, -120, 0));
    strip.setPosition(0, 240, 0);
  };

  // the confirm button: createButton(common_1017, 162x62), centred under the container when the role is below the "back to the mode" level
  const btn = new Node("confirm_btn");
  btn.layer = root.layer;
  btn.addComponent(UITransform).setContentSize(162, 62);
  const bs = btn.addComponent(Sprite);
  bs.sizeMode = Sprite.SizeMode.CUSTOM;
  atlasFrame("ui/common/common.json", "common_1017.png", [17, 17, 24, 17]).then(sf => { bs.spriteFrame = sf; }, () => {});
  btn.setPosition(0, -56 - 262.5, 0);
  const btnLabel = text(btn, "确定", 0, 0, 24, white, 0.5, 0.5, 140);
  btnLabel.enableOutline = true;
  btnLabel.outlineColor = new Color(118, 69, 25, 255);
  btnLabel.outlineWidth = 2;
  container.addChild(btn);
  const timeLabel = text(container, "", 0, -110 - 262.5, 22, white, 0.5, 0.5, 400);
  btn.active = false;
  timeLabel.node.active = false;

  let done: (() => void) | undefined;
  let closeTimer: ReturnType<typeof setInterval> | undefined;
  let ready = false;
  const close = () => {
    if (!ready) return; // the original ignores the button until its items have appeared
    ready = false;
    clearInterval(closeTimer);
    clearInterval(barTimer);
    root.active = false;
    done?.();
  };
  btn.on(Node.EventType.TOUCH_END, close);

  return {
    root,
    open(m) {
      ready = false;
      btn.active = false;
      timeLabel.node.active = false;
      const hurt = Number(m.partner_hurt ?? 0), total = Number(m.partner_total_hurt ?? 0);
      hurtValue.string = `${hurt}(${(total > 0 ? hurt / total * 100 : 0).toFixed(2)}%)`;
      const lev0 = Number(m.lev ?? 0), lev1 = Number(m.new_lev ?? 0);
      const showBar = !!expMax[lev0 - 1] && !!expMax[lev1 - 1]; // the server sends 0 until it tells the role's exp
      barBack.active = showBar;
      by.get("sprite_1")!.active = showBar;
      by.get("sprite_2")!.active = showBar;
      if (showBar) {
        levText.string = `Lv.${lev1}`;
        runBar(lev0, Number(m.exp ?? 0), lev1, Number(m.new_exp ?? 0));
      }
      fillRewards(((m.item_rewards ?? []) as { bid: number; num: number }[]).filter(r => r.bid && r.num));
      root.setSiblingIndex(root.parent!.children.length - 1);
      root.active = true;
      setTimeout(() => {
        if (!root.active) return;
        ready = true;
        btn.active = true;
        timeLabel.node.active = true;
        let left = CLOSE_SECONDS;
        timeLabel.string = `${left}秒后关闭`;
        clearInterval(closeTimer);
        closeTimer = setInterval(() => {
          left -= 1;
          timeLabel.string = `${left}秒后关闭`;
          if (left <= 0) close();
        }, 1000);
      }, 500);
      return new Promise<void>(res => { done = res; });
    },
  };
}

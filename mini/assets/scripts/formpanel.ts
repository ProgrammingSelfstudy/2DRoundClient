// The formation window of the campaign: the original `hero/form_go_fight_panel` (FormGoFightPanel) in its main-line mode. Six positions stand on a
// 3x3 grid, each on the cell its formation type gives; the heroes of the bag are listed below and tapping one puts it in the first free position (a
// second tap, or a tap on the hero in its position, takes it out). "保存布阵" sends 11212, "开战" saves and then lets the caller start the fight.
// Not built: the formation change (阵法) window, the halo, the elfin, one-key setup, the other tabs and modes of the original.
import { Color, Label, Mask, Node, Sprite, UIOpacity, UITransform } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { CELL, Hero, PartnerTable, heroCellMaker } from "./herocell";
import { listed } from "./herofilter";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";

export type Msg = { [key: string]: unknown };
export interface Formation { formation_type: number; slots: (Hero | null)[] } // slots[0..5] are positions 1..6

// data_form_data of the client: for each formation type, the cell (1-9) each position 1-6 stands on; the server (formation.go) holds the same table
const CELLS: { [type: number]: number[] } = {
  1: [9, 7, 6, 4, 5, 2], 2: [1, 3, 4, 6, 8, 5], 3: [1, 2, 3, 5, 8, 9], 4: [2, 4, 5, 6, 8, 7], 5: [2, 5, 7, 8, 9, 4], 6: [1, 3, 5, 7, 8, 9],
};
const CELL_W = 134; // FormGoFightPanel.nine_position: cell c (1-9) is at x by column (1-3 right, 4-6 middle, 7-9 left) and y by row (1 low, 2 middle, 3 high)
const nine = (c: number) => ({ x: [CELL_W, 0, -CELL_W][Math.floor((c - 1) / 3)], y: [-CELL_W + 50, 60, CELL_W + 60][(c - 1) % 3] });
const MAX = 6, COLS = 5;

export interface FormPanel {
  root: Node;
  open(formation: Msg, heroes: Hero[], canFight?: boolean): void; // canFight false: the hero page's mode, save only (HeroConst.FormShowType.eFormSave)
  close(): void;
  onSave(f: (f: Formation) => Promise<boolean>): void;
  onFight(f: (f: Formation) => void): void;
}

export async function buildFormPanel(canvas: Node, notify: (text: string) => void): Promise<FormPanel> {
  const [win, table] = await Promise.all([loadJson<LNode>("layouts/hero/form_go_fight_panel.json"), loadJson<PartnerTable>("tables/partners.json")]);
  const built = await buildLayout(win, canvas, {
    // tabs, the team tabs, the empty-list notice, the side buttons (formation change, halo, equipment, elfin), one-key setup and "skip battle" belong to modes not built
    hide: ["tab_btn", "team_tab_btn", "no_vedio_image", "no_vedio_label", "txt_cn_common_notice_1", "form_change_btn", "halo_btn", "equip_btn", "elfin_btn", "key_up_btn", "checkbox", "power_click"],
  });
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  opaqueBase(root, W, H);
  root.active = false;
  const node = (name: string) => built.byName.get(name)!;

  // the window dims what is behind it: the layout's background is a plain panel, so a translucent cover is drawn on it
  const dim = node("background");
  dim.getComponent(UITransform)!.setContentSize(W, H);
  const cover = dim.getComponent(Sprite) ?? dim.addComponent(Sprite);
  cover.sizeMode = Sprite.SizeMode.CUSTOM;
  spriteFrame("bg/bigbg_100.webp").then(sf => { if (cover.isValid) cover.spriteFrame = sf; }, () => {});
  dim.addComponent(UIOpacity).opacity = 180;

  node("win_title").getComponent(Label)!.string = "英雄出战";
  node("close_btn").on(Node.EventType.TOUCH_END, () => close());

  // the two buttons sat on top of each other in the layout (the original shows one of them per mode): save on the left, fight on the right
  const save = node("save_btn"), fight = node("fight_btn");
  save.setPosition(190, save.position.y, 0);
  fight.setPosition(486, fight.position.y, 0);
  save.getChildByName("label")!.getComponent(Label)!.string = "保存布阵";
  fight.getChildByName("label")!.getComponent(Label)!.string = "开 战";

  // power: the sum of the heroes in the positions, drawn where power_click sat
  const formPanel = node("form_panel");
  const powerNode = new Node("power");
  powerNode.layer = formPanel.layer;
  powerNode.addComponent(UITransform).setContentSize(260, 40);
  powerNode.setPosition(155, 886, 0);
  const power = powerNode.addComponent(Label);
  power.fontSize = 28;
  power.lineHeight = 32;
  power.overflow = Label.Overflow.NONE;
  power.enableOutline = true;
  power.outlineColor = new Color(40, 20, 10, 255);
  power.outlineWidth = 2;
  formPanel.addChild(powerNode);

  const stage = node("fight_hero_node");
  const bars = [1, 2, 3, 4, 5, 6].map(i => stage.getChildByName(`hero_info_21_${i}`)!); // the pedestal under each position
  const slotLayer = new Node("slots");
  slotLayer.layer = stage.layer;
  stage.addChild(slotLayer);
  slotLayer.setSiblingIndex(0);

  // tapping a hero takes it out of its position, or puts it in the first free one
  const toggle = (h: Hero) => {
    const i = slots.findIndex(s => s?.partner_id === h.partner_id);
    if (i >= 0) { slots[i] = null; redraw(); } else place(h);
  };
  const makeCell = heroCellMaker(table, stage.layer, toggle);

  let formationType = 1, everyone: Hero[] = [], campFilter = 0;
  let slots: (Hero | null)[] = Array(MAX).fill(null);
  let saveFn: (f: Formation) => Promise<boolean> = async () => true, fightFn: (f: Formation) => void = () => {};

  const current = (): Formation => ({ formation_type: formationType, slots: slots.slice() });

  // the hero list below: a clipped viewport and a content node dragged inside it, as on the hero page
  const view = node("lay_scrollview");
  const vt = view.getComponent(UITransform)!;
  view.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const content = new Node("content");
  content.layer = view.layer;
  content.addComponent(UITransform).setContentSize(vt.width, 0);
  view.addChild(content);
  const scroll = dragScroll(view, content, "y");
  const listMaker = heroCellMaker(table, view.layer, toggle);

  const place = (h: Hero) => {
    const i = slots.findIndex(s => s === null);
    if (i < 0) return notify("上阵英雄已满");
    slots[i] = h;
    redraw();
  };

  // the empty-position tile of the hero atlas, shared by the six positions
  const tile = atlasFrame("ui/hero/hero.json", "hero_info_21.png");

  const redraw = () => {
    slotLayer.removeAllChildren();
    const cells = CELLS[formationType] ?? CELLS[1];
    slots.forEach((h, i) => {
      const p = nine(cells[i]);
      bars[i].setPosition(p.x, p.y - 70, 0); // the pedestal stands 70 below its cell, as initFormationData sets it
      if (h) {
        const c = makeCell(h);
        c.setPosition(p.x, p.y, 0);
        slotLayer.addChild(c);
      } else {
        const t = new Node(`empty_${i + 1}`);
        t.layer = stage.layer;
        t.addComponent(UITransform).setContentSize(119, 119);
        t.setPosition(p.x, p.y, 0);
        const s = t.addComponent(Sprite);
        s.sizeMode = Sprite.SizeMode.CUSTOM;
        tile.then(sf => { if (s.isValid) s.spriteFrame = sf; }, () => {});
        slotLayer.addChild(t);
      }
    });
    power.string = `战力 ${slots.reduce((a, h) => a + (h?.power ?? 0), 0)}`;
    drawList();
  };

  const drawList = () => {
    content.removeAllChildren();
    const heroes = everyone
      .filter(h => listed(table, h.bid))
      .filter(h => campFilter === 0 || (table.base[String(h.bid)]?.[1] ?? 0) === campFilter)
      .sort((a, b) => b.star - a.star || b.power - a.power || a.partner_id - b.partner_id);
    const rows = Math.ceil(heroes.length / COLS);
    const contentH = Math.max(vt.height, rows * CELL);
    content.getComponent(UITransform)!.setContentSize(vt.width, contentH);
    content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    const x0 = -((COLS - 1) * CELL) / 2;
    heroes.forEach((h, i) => {
      const c = listMaker(h);
      c.setPosition(x0 + (i % COLS) * CELL, -CELL / 2 - Math.floor(i / COLS) * CELL, 0);
      // a hero already in a position is dimmed in the list
      if (slots.some(s => s?.partner_id === h.partner_id)) c.addComponent(UIOpacity).opacity = 110;
      content.addChild(c);
    });
    const top = vt.height / 2;
    scroll.range(top, top + Math.max(0, contentH - vt.height));
    content.setPosition(0, top, 0);
  };

  // the camp filter: the ring moves onto the tapped camp and the list shows that camp only
  const camp = node("camp_node");
  const ring = camp.getChildByName("img_select")!;
  [0, 1, 2, 3, 4, 5, 7].forEach(c => {
    const b = camp.getChildByName(`camp_btn${c}`)!;
    b.on(Node.EventType.TOUCH_END, () => {
      campFilter = c;
      ring.setPosition(b.position.x - 0.5, b.position.y + 1, 0);
      drawList();
    });
  });

  save.on(Node.EventType.TOUCH_END, async () => {
    if (!slots.some(Boolean)) return notify("至少上阵一名英雄");
    if (await saveFn(current())) notify("保存成功");
  });
  fight.on(Node.EventType.TOUCH_END, () => {
    if (!slots.some(Boolean)) return notify("至少上阵一名英雄");
    fightFn(current());
  });

  const close = () => { root.active = false; };

  return {
    root,
    open(formation, heroes, canFight = true) {
      fight.active = canFight;
      save.setPosition(canFight ? 190 : 338, save.position.y, 0);
      everyone = heroes;
      formationType = Number(formation.formation_type) || 1;
      campFilter = 0;
      const first = camp.getChildByName("camp_btn0")!;
      ring.setPosition(first.position.x - 0.5, first.position.y + 1, 0);
      // 11211: pos_info [{pos, id}] with the partner ids of the positions
      slots = Array(MAX).fill(null);
      const placed = (formation.pos_info as Msg[] | undefined) || [];
      for (const p of placed) {
        const pos = Number(p.pos), h = heroes.find(x => x.partner_id === Number(p.id));
        if (h && pos >= 1 && pos <= MAX) slots[pos - 1] = h;
      }
      redraw();
      root.active = true;
    },
    close,
    onSave(f) { saveFn = f; },
    onFight(f) { fightFn = f; },
  };
}

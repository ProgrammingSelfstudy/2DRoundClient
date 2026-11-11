// The formation window of the campaign: the original `hero/form_go_fight_panel` (FormGoFightPanel) in its main-line mode. Six positions stand on a
// 3x3 grid, each on the cell its formation type gives; the heroes of the bag are listed below and tapping one puts it in the first free position (a
// second tap, or a tap on the hero in its position, takes it out). "保存布阵" sends 11212, "开战" saves and then lets the caller start the fight.
// Modes as in FormGoFightPanel.setShowTypeUI: opened from the stage's boss button (fight mode) it has one tab 队伍 and the fight button; opened from the
// hero page (save mode) it has the tabs of data_partner_form (主线剧情, 竞技场防守, 冠军赛防守, 天梯赛防守) and 一键上阵 and 保存布阵.
// The heroes stand on the pedestals as Spine models (createHeroSpine). Not built: the formation change (阵法) window, the halo, the elfin and the
// artifact slots (they answer "not open"), dragging a hero between positions, the other tabs of the table.
import { Color, Label, Mask, Node, Sprite, UIOpacity, UITransform, instantiate } from "cc";
import { atlasFrame, hasFile, loadJson, spriteFrame } from "./cdn";
import { spineNode } from "./spine";
import { CELL, Hero, PartnerTable, heroCellMaker } from "./herocell";
import { listed } from "./herofilter";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";

export type Msg = { [key: string]: unknown };
export interface Formation { kind: number; formation_type: number; slots: (Hero | null)[] } // kind: the 11211/11212 type of the tab; slots[0..5] are positions 1..6
// data_partner_form: the tabs of the save mode (the first four rows of the table)
const TABS = [{ kind: 0, name: "主线剧情" }, { kind: 1, name: "竞技场防守" }, { kind: 6, name: "冠军赛防守" }, { kind: 9, name: "天梯赛防守" }];
interface Models { p: { [bidStar: string]: string } }

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
  onTab(f: (kind: number) => Promise<Msg>): void; // reads the formation of another tab (11211)
  onSave(f: (f: Formation) => Promise<boolean>): void;
  onFight(f: (f: Formation) => void): void;
}

export async function buildFormPanel(canvas: Node, notify: (text: string) => void): Promise<FormPanel> {
  const [win, table, models] = await Promise.all([loadJson<LNode>("layouts/hero/form_go_fight_panel.json"), loadJson<PartnerTable>("tables/partners.json"), loadJson<Models>("tables/battle_models.json")]);
  const built = await buildLayout(win, canvas, {
    // the team tabs (arena-like modes), the empty-list notice and "skip battle" belong to modes not built
    hide: ["team_tab_btn", "no_vedio_image", "no_vedio_label", "txt_cn_common_notice_1", "checkbox"],
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

  // the original shows one of save/fight per mode (setShowTypeUI); the layout puts both near the middle, 一键上阵 beside the save button
  const save = node("save_btn"), fight = node("fight_btn"), keyUp = node("key_up_btn");
  save.getChildByName("label")!.getComponent(Label)!.string = "保存布阵";
  fight.getChildByName("label")!.getComponent(Label)!.string = "开 战";
  keyUp.getChildByName("label")!.getComponent(Label)!.string = "一键上阵";
  const saveX = save.position.x;

  // the side buttons: formation change, halo, artifact (点击装配) and elfin (点击调整) — drawn, they answer "not open"
  node("form_change_btn").getChildByName("label")!.getComponent(Label)!.string = "更换";
  node("equip_btn").getChildByName("label")!.getComponent(Label)!.string = "点击装配";
  node("elfin_btn").getChildByName("label")!.getComponent(Label)!.string = "点击调整";
  for (const n of ["form_change_btn", "halo_btn", "equip_btn", "elfin_btn"]) {
    node(n).on(Node.EventType.TOUCH_END, () => notify(n === "form_change_btn" ? "阵法更换暂未开放" : "暂未开放"));
  }

  // power: CommonNum in the original, a label here at its place in power_click (24, 29)
  const formPanel = node("form_panel");
  const powerNode = new Node("power");
  powerNode.layer = formPanel.layer;
  powerNode.addComponent(UITransform).setContentSize(160, 40);
  powerNode.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
  powerNode.setPosition(24 - 100, 29 - 20, 0);
  const power = powerNode.addComponent(Label);
  power.fontSize = 28;
  power.lineHeight = 32;
  power.horizontalAlign = Label.HorizontalAlign.LEFT;
  power.overflow = Label.Overflow.NONE;
  power.enableOutline = true;
  power.outlineColor = new Color(40, 20, 10, 255);
  power.outlineWidth = 2;
  node("power_click").addChild(powerNode);
  node("pos_tips").getComponent(Label)!.string = "从列表选择英雄，长按英雄可查看英雄详细信息";

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
  const makeCell = heroCellMaker(table, stage.layer); // the cell of a hero without a model; the tap is the standing node's

  let formationType = 1, kind = 0, everyone: Hero[] = [], campFilter = 0;
  let slots: (Hero | null)[] = Array(MAX).fill(null);
  let saveFn: (f: Formation) => Promise<boolean> = async () => true, fightFn: (f: Formation) => void = () => {};
  let tabFn: (kind: number) => Promise<Msg> = async () => ({});

  const current = (): Formation => ({ kind, formation_type: formationType, slots: slots.slice() });

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
  // the formation icon of the change button: form_icon_<formation type> of the form atlas
  const formIcon = node("form_change_btn").getChildByName("form_icon")!.getComponent(Sprite)!;

  // the hero stands on its pedestal as its battle_stand model (createHeroSpine puts it 10 right of and 40 below the cell's centre)
  const standOf = (h: Hero, x: number, y: number): Node => {
    const hit = new Node(`hero_${h.bid}`);
    hit.layer = stage.layer;
    hit.addComponent(UITransform).setContentSize(CELL, CELL * 1.3);
    hit.setPosition(x, y, 0);
    hit.on(Node.EventType.TOUCH_END, () => toggle(h));
    const model = models.p[`${h.bid}_${h.star}`];
    if (model && hasFile(`spine/hero/${model}/stand2.json`)) {
      spineNode(`spine/hero/${model}/stand2`, "stand2", hit).then(sk => { if (hit.isValid) sk.node.setPosition(10, -40, 0); }, e => console.warn(`formation ${model}:`, (e as Error).message));
    } else {
      const c = makeCell(h); // a hero the release carries no model of stands as its head cell
      c.setPosition(0, 40, 0);
      hit.addChild(c);
    }
    return hit;
  };

  const redraw = () => {
    slotLayer.removeAllChildren();
    const cells = CELLS[formationType] ?? CELLS[1];
    atlasFrame("ui/form/form.json", `form_icon_${formationType}.png`).then(sf => { if (formIcon.isValid) formIcon.spriteFrame = sf; }, () => {});
    slots.forEach((h, i) => {
      const p = nine(cells[i]);
      bars[i].setPosition(p.x, p.y - 70, 0); // the pedestal stands 70 below its cell, as initFormationData sets it
      if (h) {
        slotLayer.addChild(standOf(h, p.x, p.y));
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
    power.string = String(slots.reduce((a, h) => a + (h?.power ?? 0), 0));
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

  // the tabs: a clone of the layout's cell per tab, the selected one shows select_img (updateCellByIndexTabBtn)
  const tabBox = node("tab_btn");
  const tabCell = tabBox.getChildByName("tab_btn_1")!;
  let tabs: { cell: Node; kind: number }[] = [];
  const mark = () => tabs.forEach(t => {
    t.cell.getChildByName("select_img")!.active = t.kind === kind;
    t.cell.getChildByName("normal_img")!.active = t.kind !== kind;
  });
  let loadSeq = 0;
  const drawTabs = (list: { kind: number; name: string }[]) => {
    for (const t of tabs) t.cell.destroy();
    tabs = list.map((t, i) => {
      const cell = instantiate(tabCell);
      cell.active = true;
      cell.setPosition(tabCell.position.x + i * 135 - 0, tabCell.position.y, 0);
      cell.getChildByName("label")!.getComponent(Label)!.string = t.name;
      cell.getChildByName("red_point")!.active = false;
      cell.on(Node.EventType.TOUCH_END, async () => {
        if (t.kind === kind) return;
        const seq = ++loadSeq;
        let reply: Msg;
        try { reply = await tabFn(t.kind); } catch (e) { return notify((e as Error).message); }
        if (seq !== loadSeq) return; // a later tap won
        load(reply, t.kind);
        redraw();
      });
      tabBox.addChild(cell);
      return { cell, kind: t.kind };
    });
    mark();
  };

  // 11211: pos_info [{pos, id}] with the partner ids of the positions
  const load = (formation: Msg, k: number) => {
    kind = k;
    formationType = Number(formation.formation_type) || 1;
    slots = Array(MAX).fill(null);
    const placed = (formation.pos_info as Msg[] | undefined) || [];
    for (const p of placed) {
      const pos = Number(p.pos), h = everyone.find(x => x.partner_id === Number(p.id));
      if (h && pos >= 1 && pos <= MAX) slots[pos - 1] = h;
    }
    mark();
  };

  // 一键上阵: the strongest heroes not yet in a position fill the empty ones
  keyUp.on(Node.EventType.TOUCH_END, () => {
    const free = slots.map((s, i) => (s ? -1 : i)).filter(i => i >= 0);
    if (!free.length) return notify("上阵英雄已满");
    const rest = everyone.filter(h => listed(table, h.bid) && !slots.some(s => s?.partner_id === h.partner_id)).sort((a, b) => b.power - a.power || a.partner_id - b.partner_id);
    if (!rest.length) return notify("没有可上阵的英雄");
    free.forEach((pos, n) => { if (rest[n]) slots[pos] = rest[n]; });
    redraw();
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
      // setShowTypeUI: fight mode has the fight button only, save mode the save button and 一键上阵
      fight.active = canFight;
      save.active = !canFight;
      keyUp.active = !canFight;
      fight.setPosition(saveX, fight.position.y, 0); // alone: in the middle
      keyUp.setPosition(205, keyUp.position.y, 0); // together: 一键上阵 left, 保存布阵 right
      save.setPosition(485, save.position.y, 0);
      everyone = heroes;
      campFilter = 0;
      const first = camp.getChildByName("camp_btn0")!;
      ring.setPosition(first.position.x - 0.5, first.position.y + 1, 0);
      load(formation, Number(formation.type) || 0);
      drawTabs(canFight ? [{ kind: 0, name: "队伍" }] : TABS);
      redraw();
      root.active = true;
    },
    close,
    onTab(f) { tabFn = f; },
    onSave(f) { saveFn = f; },
    onFight(f) { fightFn = f; },
  };
}

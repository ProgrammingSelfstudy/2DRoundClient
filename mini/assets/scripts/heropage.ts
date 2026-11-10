// The hero list: the original `hero/hero_bag_window` with one cell per hero, drawn the way the original's HeroExhibitionItem does (Lua-built, no
// layout of its own): a quality frame by star, the head picture, the camp badge, level and stars. The grid scrolls by dragging.
import { Color, Label, Mask, Node, Sprite, UITransform } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { CELL, Hero, PartnerTable, heroCellMaker } from "./herocell";
import { listed } from "./herofilter";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";

const COLS = 5;

export interface HeroPage { root: Node; setHeroes(list: Hero[], capacity?: number): void; show(on: boolean): void; onHero(f: (h: Hero) => void): void; onEmbattle(f: () => void): void; onTab(f: (index: number) => void): void }

export async function buildHeroPage(canvas: Node): Promise<HeroPage> {
  let everyone: Hero[] = [], cap: number | undefined, campFilter = 0;
  let tapHero: (h: Hero) => void = () => {}, embattle = () => {}, tapTab: (index: number) => void = () => {};
  let renderHeroes = () => {}; // set once the grid code below exists; the camp buttons are wired before that
  const [win, table] = await Promise.all([loadJson<LNode>("layouts/hero/hero_bag_window.json"), loadJson<PartnerTable>("tables/partners.json")]);
  const built = await buildLayout(win, canvas, {
    // the empty-state notice, the library button (the original hides it too), the divider and the overlay panel stay hidden
    hide: ["no_vedio_label", "no_vedio_image", "library_btn", "img_line", "con_panel"],
  });
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  opaqueBase(root, W, H);
  root.active = false;

  // the layout's background and box_1 are placeholders; hero_bag_window.lua loads the window's own pictures into them
  const picture = async (name: string, logical: string, w: number, h: number) => {
    const n = built.byName.get(name)!;
    const s = n.getComponent(Sprite) ?? n.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    try { s.spriteFrame = await spriteFrame(logical); } catch (e) { console.warn(`hero ${name}:`, e); }
    n.getComponent(UITransform)!.setContentSize(w, h);
  };
  await Promise.all([picture("background", "bg/hero/hero_bag_bg.webp", W, H), picture("box_1", "bg/hero/hero_bag_bg_1.webp", 720, 990)]);

  built.byName.get("embattle_btn")?.on(Node.EventType.TOUCH_END, () => embattle()); // the formation button of the hero page

  // the camp filter on the hero tab: seven round buttons 58 wide and 20 apart centred on the node (HeroBagWindow.setCampBtnPos), the ring on "all"
  const camp = built.byName.get("camp_node")!;
  const xs = [0, 1, 2, 3, 4, 5, 7].map((_, i) => -(58 * 7 + 20 * 6) / 2 + 29 + i * 78);
  [0, 1, 2, 3, 4, 5, 7].forEach((c, i) => { const b = camp.getChildByName(`camp_btn${c}`)!; b.setPosition(xs[i], b.position.y, 0); });
  const ring = camp.getChildByName("img_select")!;
  ring.setPosition(xs[0] - 0.5, camp.getChildByName("camp_btn0")!.position.y + 1, 0);
  // tapping a camp moves the ring onto it and filters the grid (the original: _onClickBtnShowByIndex -> updateHeroList)
  [0, 1, 2, 3, 4, 5, 7].forEach((c, i) => {
    camp.getChildByName(`camp_btn${c}`)!.on(Node.EventType.TOUCH_END, () => {
      campFilter = c;
      ring.setPosition(xs[i] - 0.5, camp.getChildByName("camp_btn0")!.position.y + 1, 0);
      renderHeroes();
    });
  });

  // the four tabs (英雄 图鉴 幽灵 信念): the first is this page; a tap on any is handed to onTab (图鉴 opens the library, the others have no page yet)
  const tabs = ["英雄", "图鉴", "幽灵", "信念"];
  tabs.forEach((title, i) => {
    const btn = built.byName.get("tab_container")!.getChildByName(`tab_btn_${i + 1}`)!;
    const label = btn.getChildByName("label")!.getComponent(Label)!;
    label.string = title;
    label.fontSize = 24;
    label.lineHeight = 28;
    label.overflow = Label.Overflow.NONE;
    const on = i === 0;
    label.color = on ? new Color(255, 255, 255, 255) : new Color(248, 194, 60, 255);
    btn.getChildByName("select_img")!.active = on;
    btn.getChildByName("normal_img")!.active = !on;
    btn.getChildByName("red_point")!.active = false;
    btn.on(Node.EventType.TOUCH_END, () => tapTab(i));
  });

  // the scroll area: a clipped viewport and a content node dragged inside it
  const view = built.byName.get("lay_scrollview")!;
  const vt = view.getComponent(UITransform)!;
  view.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const content = new Node("content");
  content.layer = view.layer;
  content.addComponent(UITransform).setContentSize(vt.width, 0);
  view.addChild(content);
  const scroll = dragScroll(view, content, "y");

  const makeCell = heroCellMaker(table, view.layer, h => tapHero(h));

  const count = built.byName.get("item_buy_panel")?.getChildByName("label")?.getComponent(Label);

  // draw the heroes of the chosen camp (0: all), strongest first; the count under the grid is of the whole bag, as in the original
  const render = () => {
    content.removeAllChildren();
    const heroes = everyone
      .filter(h => listed(table, h.bid))
      .filter(h => campFilter === 0 || (table.base[String(h.bid)]?.[1] ?? 0) === campFilter)
      .sort((a, b) => b.star - a.star || b.power - a.power || a.partner_id - b.partner_id);
    const rows = Math.ceil(heroes.length / COLS);
    const contentH = Math.max(vt.height, rows * CELL);
    content.getComponent(UITransform)!.setContentSize(vt.width, contentH);
    content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    // content hangs from the top of the viewport; scrolling moves it up by at most the overflow
    const x0 = -((COLS - 1) * CELL) / 2;
    heroes.forEach((h, i) => {
      const c = makeCell(h);
      c.setPosition(x0 + (i % COLS) * CELL, -CELL / 2 - Math.floor(i / COLS) * CELL, 0);
      content.addChild(c);
    });
    const top = vt.height / 2;
    scroll.range(top, top + Math.max(0, contentH - vt.height));
    content.setPosition(0, top, 0);
    if (count) count.string = cap ? `${everyone.length}/${cap}` : String(everyone.length);
  };
  renderHeroes = render;

  return {
    root,
    setHeroes(list, capacity) { everyone = list; cap = capacity; render(); },
    show(on) { root.active = on; },
    onHero(f) { tapHero = f; },
    onEmbattle(f) { embattle = f; },
    onTab(f) { tapTab = f; },
  };
}

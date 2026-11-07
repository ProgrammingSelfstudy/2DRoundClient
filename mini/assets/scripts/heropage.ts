// The hero list: the original `hero/hero_bag_window` with one cell per hero, drawn the way the original's HeroExhibitionItem does (Lua-built, no
// layout of its own): a quality frame by star, the head picture, the camp badge, level and stars. The grid scrolls by dragging.
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { W, H } from "./loginpage";
import type { SpriteFrame } from "cc";

interface Hero { partner_id: number; bid: number; lev: number; star: number; power: number }
interface PartnerTable { base: { [bid: string]: [string, number, number] }; head: { [key: string]: number } }

const CELL = 119, COLS = 5;
const COMMON = "ui/common/common.json";
// HeroConst.CampType -> the badge frame (PathTool.getHeroCampTypeIcon)
const CAMP: { [camp: number]: string } = { 1: "common_90067", 2: "common_90068", 3: "common_90069", 4: "common_90070", 5: "common_90079", 7: "common_900072" };

export interface HeroPage { root: Node; setHeroes(list: Hero[], capacity?: number): void; show(on: boolean): void }

export async function buildHeroPage(canvas: Node): Promise<HeroPage> {
  let everyone: Hero[] = [], cap: number | undefined, campFilter = 0;
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

  // the four tabs (英雄 图鉴 幽灵 信念): the first is shown; the others have no page yet
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
  });

  // the scroll area: a clipped viewport and a content node dragged inside it
  const view = built.byName.get("lay_scrollview")!;
  const vt = view.getComponent(UITransform)!;
  view.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const content = new Node("content");
  content.layer = view.layer;
  content.addComponent(UITransform).setContentSize(vt.width, 0);
  view.addChild(content);
  let minY = 0, maxY = 0;
  view.on(Node.EventType.TOUCH_MOVE, (e: { getUIDelta(): { y: number } }) => {
    const y = Math.min(maxY, Math.max(minY, content.position.y + e.getUIDelta().y));
    content.setPosition(0, y, 0);
  });

  const frames = new Map<string, Promise<SpriteFrame>>();
  const common = (name: string) => {
    let f = frames.get(name);
    if (!f) frames.set(name, (f = atlasFrame(COMMON, name + ".png")));
    return f;
  };
  const sprite = (parent: Node, name: string, x: number, y: number, w: number, h: number) => {
    const n = new Node(name);
    n.layer = parent.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const s = n.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    parent.addChild(n);
    return s;
  };
  const setFrame = (s: Sprite, f: Promise<SpriteFrame>) => { f.then(sf => { if (s.isValid) s.spriteFrame = sf; }, () => {}); };

  const makeCell = (h: Hero): Node => {
    const cell = new Node(`hero_${h.bid}`);
    cell.layer = view.layer;
    cell.addComponent(UITransform).setContentSize(CELL, CELL);
    const star = Math.max(1, h.star);
    setFrame(sprite(cell, "quality", 0, 0, CELL, CELL), common(`common_${1005 + Math.min(5, star - 1)}`));
    const headId = table.head[`${h.bid}_${h.star}`] ?? h.bid;
    const head = sprite(cell, "head", 0, 0, CELL, CELL);
    spriteFrame(`icons/head/${headId}.webp`).then(sf => { if (head.isValid) { head.spriteFrame = sf; head.sizeMode = Sprite.SizeMode.RAW; } }, () => {}); // RAW: the head keeps its own size, so the quality frame shows around it
    const camp = table.base[String(h.bid)]?.[1] ?? 0;
    if (camp) {
      const c = sprite(cell, "camp", 19 - CELL / 2, 100 - CELL / 2, 58, 58);
      c.node.setScale(0.6, 0.6, 1);
      setFrame(c, common(CAMP[camp] ?? "common_90071"));
    }
    // stars along the bottom: 12 px apart, centred (stars 6 and up use a different frame in the original; plain stars for now)
    for (let i = 0; i < Math.min(star, 5); i++) {
      setFrame(sprite(cell, "star", (i - (Math.min(star, 5) - 1) / 2) * 12, 20 - CELL / 2, 20, 20), common("common_90074"));
    }
    const lv = new Node("lev");
    lv.layer = cell.layer;
    lv.addComponent(UITransform).setContentSize(60, 30);
    lv.getComponent(UITransform)!.setAnchorPoint(1, 0);
    lv.setPosition(107 - CELL / 2, 81 - CELL / 2, 0);
    const l = lv.addComponent(Label);
    l.string = String(h.lev);
    l.fontSize = 24;
    l.lineHeight = 28;
    l.horizontalAlign = HorizontalTextAlignment.RIGHT;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.NONE;
    l.color = new Color(255, 255, 255, 255);
    l.enableOutline = true;
    l.outlineColor = new Color(40, 20, 10, 255);
    l.outlineWidth = 2;
    cell.addChild(lv);
    return cell;
  };

  const count = built.byName.get("item_buy_panel")?.getChildByName("label")?.getComponent(Label);

  // draw the heroes of the chosen camp (0: all), strongest first; the count under the grid is of the whole bag, as in the original
  const render = () => {
    content.removeAllChildren();
    const heroes = everyone
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
    minY = vt.height / 2;
    maxY = minY + Math.max(0, contentH - vt.height);
    content.setPosition(0, minY, 0);
    if (count) count.string = cap ? `${everyone.length}/${cap}` : String(everyone.length);
  };
  renderHeroes = render;

  return {
    root,
    setHeroes(list, capacity) { everyone = list; cap = capacity; render(); },
    show(on) { root.active = on; },
  };
}

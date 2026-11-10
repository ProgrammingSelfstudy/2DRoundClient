// The hero library (图鉴): the original `hero/hero_library_main_window` (HeroLibraryMainWindow). Every hero of the client's table, five head cells to a
// row, grouped by career (type) and ordered by initial star, with the camp buttons of the bottom bar as a filter. It is driven by the client's
// own table (data_partner_base), so it needs no server call. Each hero is the hero page's head cell (grey when the player does not have it); a tap
// opens the hero info window with the standing model. (The original's package card pictures do not match their heroes, so none are used.)
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { listed } from "./herofilter";
import { CELL, heroCellMaker } from "./herocell";
import type { PartnerTable } from "./herocell";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";

type Row = PartnerTable["base"][string];

const COLS = 5, ITEM_W = CELL, ITEM_H = CELL, TITLE_H = 80, FIRST_TITLE_H = 50; // the cell step: the hero page's
const LIBRARY = "ui/herolibrary/herolibrary.json";
const CAREER: { [type: number]: string } = { 2: "法师", 3: "战士", 4: "坦克", 5: "辅助" }; // HeroConst.CareerName

export interface HeroLibrary { root: Node; open(): void; close(): void; onClose(f: () => void): void; onHero(f: (bid: number, star: number) => void): void }

export async function buildHeroLibrary(canvas: Node, owned: () => Set<number>): Promise<HeroLibrary> {
  const [win, table] = await Promise.all([
    loadJson<LNode>("layouts/hero/hero_library_main_window.json"),
    loadJson<PartnerTable>("tables/partners.json"),
  ]);
  const built = await buildLayout(win, canvas, {});
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  opaqueBase(root, W, H);
  root.active = false;
  const node = (name: string) => built.byName.get(name)!;
  let closeFn = () => {}, tapHero: (bid: number, star: number) => void = () => {};

  // the layout's background is a placeholder; the window loads bigbg/hero/hero_bag_bg into it, as the hero bag does
  const bg = node("background");
  const bgSprite = bg.getComponent(Sprite) ?? bg.addComponent(Sprite);
  bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
  spriteFrame("bg/hero/hero_bag_bg.webp").then(sf => { if (bgSprite.isValid) bgSprite.spriteFrame = sf; }, e => console.warn("hero library background:", e));
  bg.getComponent(UITransform)!.setContentSize(W, H);

  // the layout stretches the 75x66 back picture as a nine-patch whose insets (109 wide) do not fit it and so draw it garbled: show it as it is
  const closeSprite = node("close_btn").getComponent(Sprite);
  if (closeSprite) { closeSprite.type = Sprite.Type.SIMPLE; closeSprite.sizeMode = Sprite.SizeMode.RAW; }
  node("close_btn").on(Node.EventType.TOUCH_END, () => { root.active = false; closeFn(); });

  // the scroll area: a clipped viewport and a content node dragged inside it (as the hero page does)
  const view = node("lay_scrollview");
  const vt = view.getComponent(UITransform)!;
  // the layout anchors the area at its bottom left corner; the content below hangs from the middle of the viewport, as on the hero page
  view.setPosition(view.position.x + vt.width / 2, view.position.y + vt.height / 2, 0);
  vt.setAnchorPoint(0.5, 0.5);
  view.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const content = new Node("content");
  content.layer = view.layer;
  const ct = content.addComponent(UITransform);
  ct.setAnchorPoint(0.5, 1);
  view.addChild(content);
  const scroll = dragScroll(view, content, "y");

  const text = (parent: Node, s: string, x: number, y: number, size: number, color: Color, align = HorizontalTextAlignment.LEFT) => {
    const n = new Node("text");
    n.layer = parent.layer;
    n.addComponent(UITransform).setContentSize(200, size + 8);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.string = s;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = align;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.NONE;
    l.color = color;
    parent.addChild(n);
    return n;
  };

  // one card: the same head cell as the hero page (quality frame, head, camp, stars), grey when the player does not have the hero; a tap opens the
  // hero info window with the standing model
  const makeCell = heroCellMaker(table, root.layer, h => tapHero(h.bid, h.star));
  const card = (bid: number, row: Row): Node => {
    const cell = makeCell({ partner_id: 0, bid, lev: 1, star: row[2], power: 0 });
    cell.getChildByName("lev")?.destroy(); // a library entry has no level
    if (!owned().has(bid)) for (const s of cell.getComponentsInChildren(Sprite)) s.grayscale = true;
    content.addChild(cell);
    return cell;
  };

  const ring = node("img_select");
  const campBtn = (c: number) => node("camp_node").getChildByName(`camp_btn${c}`)!;
  let camp = 0, drawn = -1;

  // the grid for one camp (0: all): sorted by career, initial star (high first), camp, then the show order, with a title where the career changes
  const render = async () => {
    const seq = ++drawn;
    content.removeAllChildren();
    const rows = Object.keys(table.base)
      .map(k => ({ bid: Number(k), row: table.base[k] }))
      .filter(h => listed(table, h.bid) && (camp === 0 || h.row[1] === camp))
      .sort((a, b) => a.row[3] - b.row[3] || b.row[2] - a.row[2] || a.row[1] - b.row[1] || a.row[4] - b.row[4] || a.bid - b.bid);
    let y = 0, col = 0, type = -1;
    const left = (vt.width - ITEM_W * COLS) / 2;
    const placed: { bid: number; row: Row; x: number; y: number }[] = [];
    for (const h of rows) {
      if (h.row[3] !== type) {
        if (type !== -1) y += ITEM_H; // the last row of the career before
        col = 0;
        const band = type === -1 ? FIRST_TITLE_H : TITLE_H;
        const strip = new Node("career");
        strip.layer = content.layer;
        strip.addComponent(UITransform).setContentSize(232, 48);
        strip.setPosition(-vt.width / 2 + left + 116, -(y + band - 24), 0);
        const s = strip.addComponent(Sprite);
        s.sizeMode = Sprite.SizeMode.CUSTOM;
        atlasFrame(LIBRARY, "hero_library_18.png").then(sf => { if (s.isValid) s.spriteFrame = sf; }, () => {});
        text(strip, CAREER[h.row[3]] ?? "", 0, 0, 24, new Color(12, 77, 175, 255));
        content.addChild(strip);
        y += band;
        type = h.row[3];
      } else if (col === 0) y += ITEM_H;
      placed.push({ bid: h.bid, row: h.row, x: -vt.width / 2 + left + ITEM_W * col + ITEM_W / 2, y: -(y + ITEM_H / 2) });
      col = (col + 1) % COLS;
    }
    const total = rows.length ? y + ITEM_H : 0;
    ct.setContentSize(vt.width, Math.max(vt.height, total));
    const top = vt.height / 2;
    scroll.range(top, top + Math.max(0, total - vt.height));
    content.setPosition(0, top, 0);
    for (const p of placed) {
      if (seq !== drawn) return; // another camp was chosen
      card(p.bid, p.row).setPosition(p.x, p.y, 0);
    }
  };

  // the six camp buttons of the bottom bar (all, and five camps): the ring moves onto the chosen one (onClickBtnShowByIndex)
  for (let c = 0; c <= 5; c++) {
    campBtn(c).on(Node.EventType.TOUCH_END, () => {
      camp = c;
      const b = campBtn(c);
      ring.setPosition(b.position.x - 0.5, b.position.y + 1, 0);
      void render();
    });
  }

  return {
    root,
    open() {
      root.active = true;
      root.setSiblingIndex(root.parent!.children.length); // a full-screen window of the original: over the top bar and the tabs, which are built after it
      camp = 0;
      const b = campBtn(0);
      ring.setPosition(b.position.x - 0.5, b.position.y + 1, 0);
      void render();
    },
    close() { root.active = false; },
    onClose(f) { closeFn = f; },
    onHero(f) { tapHero = f; },
  };
}

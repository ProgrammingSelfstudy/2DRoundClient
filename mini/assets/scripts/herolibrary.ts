// The hero library (图鉴): the original `hero/hero_library_main_window` (HeroLibraryMainWindow). Every hero of the client's table, three cards to a
// row, grouped by career (type) and ordered by initial star, with the camp buttons of the bottom bar as a filter. It is driven by the client's
// own table (data_partner_base), so it needs no server call. The original draws a hero's card from bigbg/partnercard and opens a picture window
// for the heroes that have a drawing; the package carries only some of those pictures (the newer heroes' came from the original's CDN), so a
// hero with no card here shows its Spine model on the card, and tapping a card opens the hero info window with the model instead.
import { Color, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, hasFile, loadJson, spriteFrame } from "./cdn";
import { listed } from "./herofilter";
import type { PartnerTable } from "./herocell";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { W, H } from "./loginpage";
import { spineNode } from "./spine";

type Row = PartnerTable["base"][string];
interface Models { p: { [key: string]: string } }

const COLS = 3, ITEM_W = 220, ITEM_H = 335, TITLE_H = 80, FIRST_TITLE_H = 50, CARD_W = 206, CARD_H = 325; // the cell step and the item layout's own size
const COMMON = "ui/common/common.json", LIBRARY = "ui/herolibrary/herolibrary.json";
const CAREER: { [type: number]: string } = { 2: "法师", 3: "战士", 4: "坦克", 5: "辅助" }; // HeroConst.CareerName
const CAMP: { [camp: number]: string } = { 1: "common_90067", 2: "common_90068", 3: "common_90069", 4: "common_90070", 5: "common_90079" };

export interface HeroLibrary { root: Node; open(): void; close(): void; onClose(f: () => void): void; onHero(f: (bid: number, star: number) => void): void }

export async function buildHeroLibrary(canvas: Node): Promise<HeroLibrary> {
  const [win, item, table, models] = await Promise.all([
    loadJson<LNode>("layouts/hero/hero_library_main_window.json"),
    loadJson<LNode>("layouts/hero/hero_library_main_item.json"),
    loadJson<PartnerTable>("tables/partners.json"),
    loadJson<Models>("tables/battle_models.json"),
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
  let minY = 0, maxY = 0, moved = 0;
  view.on(Node.EventType.TOUCH_START, () => { moved = 0; });
  view.on(Node.EventType.TOUCH_MOVE, (e: { getUIDelta(): { y: number } }) => {
    const dy = e.getUIDelta().y;
    moved += Math.abs(dy);
    content.setPosition(0, Math.min(maxY, Math.max(minY, content.position.y + dy)), 0);
  });

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

  // one card: the item layout, its picture and the model when there is no picture
  const card = async (bid: number, row: Row): Promise<Node> => {
    const b = await buildLayout(item, content, {});
    const r = b.root;
    const star = row[2];
    const icon = b.byName.get("hero_icon")!;
    const set = (name: string, atlas: string, frame: string) => {
      const sp = b.byName.get(name)!.getComponent(Sprite);
      if (sp) atlasFrame(atlas, frame).then(sf => { if (sp.isValid) sp.spriteFrame = sf; }, () => {});
    };
    set("camp_icon", COMMON, `${CAMP[row[1]] ?? "common_90071"}.png`);
    set("profession_icon", COMMON, `common_900${45 + row[3]}.png`);
    const name = b.byName.get("name")!.getComponent(Label)!;
    name.string = row[0];
    const picture = `bg/partnercard/partnercard_${bid}.webp`;
    if (hasFile(picture)) {
      const sp = icon.getComponent(Sprite) ?? icon.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.RAW;
      icon.setScale(0.6, 0.6, 1);
      spriteFrame(picture).then(sf => { if (sp.isValid) { sp.spriteFrame = sf; icon.getComponent(UITransform)!.setContentSize(sf.width, sf.height); } }, () => {});
    } else {
      icon.getComponent(Sprite)?.destroy();
      const model = models.p[`${bid}_${star}`];
      // the model stands on the bottom of the card (the node is 0.6 scaled and centred on the card, whose picture is 320x521)
      if (model) spineNode(`spine/hero/${model}/stand2`, "stand2", icon).then(s => { s.node.setScale(2.2, 2.2, 1); s.node.setPosition(0, -235, 0); }, () => {});
    }
    r.on(Node.EventType.TOUCH_END, () => { if (moved < 12) tapHero(bid, star); });
    return r;
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
    minY = vt.height / 2;
    maxY = minY + Math.max(0, total - vt.height);
    content.setPosition(0, minY, 0);
    for (const p of placed) {
      const r = await card(p.bid, p.row);
      if (seq !== drawn) { r.destroy(); return; } // another camp was chosen while the cards were being built
      r.setPosition(p.x - CARD_W / 2, p.y - CARD_H / 2, 0); // the item layout's origin is its bottom left corner
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

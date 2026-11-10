// One hero cell of the original's HeroExhibitionItem (Lua-built, no layout of its own): a quality frame by star, the head picture, the camp badge,
// level and stars. Shared by the hero list and the formation window's hero list.
import { Color, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, spriteFrame } from "./cdn";
import type { SpriteFrame } from "cc";

export interface Hero { partner_id: number; bid: number; lev: number; star: number; power: number; break_lev?: number }
// base row: name, camp, initial star, career type, show order, rare flag, has a drawing (partners_table.py)
export interface PartnerTable { base: { [bid: string]: [string, number, number, number, number, number, number] }; head: { [key: string]: number } }

export const CELL = 119;
const COMMON = "ui/common/common.json";
// HeroConst.CampType -> the badge frame (PathTool.getHeroCampTypeIcon)
const CAMP: { [camp: number]: string } = { 1: "common_90067", 2: "common_90068", 3: "common_90069", 4: "common_90070", 5: "common_90079", 7: "common_900072" };

export function heroCellMaker(table: PartnerTable, layer: number, onTap?: (h: Hero) => void): (h: Hero) => Node {
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
    cell.layer = layer;
    cell.addComponent(UITransform).setContentSize(CELL, CELL);
    cell.on(Node.EventType.TOUCH_END, (e: { getUILocation(): { x: number; y: number }; getUIStartLocation(): { x: number; y: number } }) => {
      // a drag that scrolled the grid is not a tap
      const a = e.getUILocation(), b = e.getUIStartLocation();
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 10) onTap?.(h);
    });
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
  return makeCell;
}

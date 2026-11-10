// The backpack page: the original `backpack/backpack_window` with one `goods_item` per slot, five columns by four rows (the quick-sell button sits under the fifth), paged with the
// side arrows. The icon of an item is looked up in the release's item table (tables/items.json: name, icon number, type, quality).
import { Color, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { spineNode } from "./spine";
import { W, H } from "./design";

interface Slot { base_id: number; quantity: number }
type ItemTable = { [id: string]: [string, number, number, number, number] }; // name, icon, type, quality, sub type

const COLS = 5, ROWS = 4, CELL = 119, GAP = 8;

export interface BackpackPage { root: Node; setItems(items: Slot[], equips?: Slot[]): void; show(on: boolean): void }

// BackPackConst.item_tab_type of the five tabs (装备 道具 碎片 特殊 幽灵): equipment lives in its own bag, the rest are the item bag split by sub type
const TAB_SUB = [1, 2, 3, 4, 6];

export async function buildBackpackPage(canvas: Node): Promise<BackpackPage> {
  const [win, cell, items] = await Promise.all([
    loadJson<LNode>("layouts/backpack/backpack_window.json"),
    loadJson<LNode>("layouts/backpack/goods_item.json"),
    loadJson<ItemTable>("tables/items.json"),
  ]);
  const built = await buildLayout(win, canvas, {});
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  opaqueBase(root, W, H);
  root.active = false;

  // the window's own pictures, which backpack_window.lua loads over the layout's placeholders: the library backdrop, and a strip of pattern_3
  // across the paper at y = 55 stretched 1.5 times in height
  const bg = built.byName.get("background")!;
  const bgSprite = bg.getComponent(Sprite) ?? bg.addComponent(Sprite);
  bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
  try { bgSprite.spriteFrame = await spriteFrame("bg/bigbg_2.webp"); } catch (e) { console.warn("backpack background:", e); }
  bg.getComponent(UITransform)!.setContentSize(W, H);
  const paper = built.byName.get("Image_1_0")!;
  const strip = new Node("pattern");
  strip.layer = paper.layer;
  strip.addComponent(UITransform).setContentSize(691, 14);
  strip.setScale(1, 1.5, 1);
  const stripSprite = strip.addComponent(Sprite);
  stripSprite.sizeMode = Sprite.SizeMode.CUSTOM;
  spriteFrame("bg/pattern_3.webp").then(sf => { stripSprite.spriteFrame = sf; }, () => {});
  const pt = paper.getComponent(UITransform)!;
  strip.setPosition((pt.width / 2) - pt.width * pt.anchorX, 55 - pt.height * pt.anchorY, 0); // (width / 2, 55) of the paper, in its own space
  paper.addChild(strip);

  // the title picture is a Spine effect (640 = E24120) the Lua puts into title_img at (-122, -180) of its bottom-left corner; the node's anchor is its
  // bottom-right corner, which is where a Creator child's position is measured from
  const title = built.byName.get("title_img")!;
  spineNode("spine/fx/E24120/action", "action", title).then(s => s.node.setPosition(-122 - 46, -180, 0), e => console.warn(`backpack title: ${(e as Error).message}`));

  // the category tabs (装备 道具 碎片 特殊 幽灵), 128 x 64 from x = 40; the second, 道具, is the one the window opens on
  const tabBox = built.byName.get("tab_container")!;
  const tabViews: { sprite: Sprite; label: Label }[] = [];
  let tab = 1;
  ["装备", "道具", "碎片", "特殊", "幽灵"].forEach((title, i) => {
    const on = i === tab;
    const n = new Node(`tab_${i}`);
    n.layer = tabBox.layer;
    n.addComponent(UITransform).setContentSize(128, 64);
    n.setPosition(40 + 64 + i * 130, 3 + 32, 0);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    atlasFrame("ui/backpack/backpack.json", on ? "backpack_3.png" : "backpack_2.png").then(sf => { sp.spriteFrame = sf; }, () => {});
    const t = new Node("label");
    t.layer = n.layer;
    t.addComponent(UITransform).setContentSize(128, 40);
    const l = t.addComponent(Label);
    l.string = title;
    l.fontSize = 26;
    l.lineHeight = 30;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.color = on ? new Color(255, 255, 255, 255) : new Color(248, 194, 60, 255);
    l.enableOutline = true;
    l.outlineColor = new Color(2, 0, 25, 255);
    l.outlineWidth = 2;
    n.addChild(t);
    tabBox.addChild(n);
    tabViews.push({ sprite: sp, label: l });
    n.on(Node.EventType.TOUCH_END, () => selectTab(i));
  });

  // the cells sit in the framed area (Image_1, 662x682, centred in `container`); its top-left is where the grid starts
  const frame = built.byName.get("Image_1")!;
  const gridW = COLS * CELL + (COLS - 1) * GAP;
  const fs = frame.getComponent(UITransform)!.contentSize;
  const x0 = frame.position.x - gridW / 2 + CELL / 2;
  const y0 = frame.position.y + fs.height / 2 - CELL / 2 - 14; // the grid hangs from the top of the frame
  const holder = built.byName.get("container")!;

  const cells: { node: Node; icon: Node; num: Label }[] = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const c = await buildLayout(cell, holder);
    c.root.setPosition(x0 + (i % COLS) * (CELL + GAP) - CELL / 2, y0 - Math.floor(i / COLS) * (CELL + GAP) - CELL / 2, 0);
    const icon = c.byName.get("icon")!;
    icon.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
    const num = c.byName.get("num")!.getComponent(Label) ?? c.byName.get("num")!.addComponent(Label);
    num.overflow = Label.Overflow.NONE; // the layout's label is 14 px wide, a stack of three digits must not wrap
    num.enableWrapText = false;
    num.horizontalAlign = HorizontalTextAlignment.RIGHT;
    cells.push({ node: c.root, icon, num });
  }

  let bag: Slot[] = [], equips: Slot[] = [];
  let all: Slot[] = [];
  let page = 0;
  // what the current tab shows: the equipment bag, or the item bag's stacks of that sub type
  const refill = () => {
    all = tab === 0 ? equips : bag.filter(s => (items[String(s.base_id)]?.[4] ?? 2) === TAB_SUB[tab]);
    page = 0;
  };
  const selectTab = (i: number) => {
    tab = i;
    tabViews.forEach((v, j) => {
      atlasFrame("ui/backpack/backpack.json", j === i ? "backpack_3.png" : "backpack_2.png").then(sf => { v.sprite.spriteFrame = sf; }, () => {});
      v.label.color = j === i ? new Color(255, 255, 255, 255) : new Color(248, 194, 60, 255);
    });
    refill();
    void render();
  };
  const pages = () => Math.max(1, Math.ceil(all.length / cells.length));
  const render = async () => {
    for (let i = 0; i < cells.length; i++) {
      const slot = all[page * cells.length + i];
      const c = cells[i];
      c.icon.active = !!slot;
      c.num.node.active = !!slot && slot.quantity > 1;
      if (!slot) continue;
      c.num.string = String(slot.quantity);
      const info = items[String(slot.base_id)];
      const sprite = c.icon.getComponent(Sprite)!;
      try {
        sprite.spriteFrame = await spriteFrame(`icons/item/${info ? info[1] : slot.base_id}.webp`);
        c.icon.getComponent(UITransform)!.setContentSize(CELL * 0.82, CELL * 0.82);
      } catch {
        sprite.spriteFrame = null; // an item whose icon is not in the release yet
      }
    }
    for (const [name, show] of [["left_arrow", page > 0], ["right_arrow", page < pages() - 1]] as const) built.byName.get(name)!.active = show;
  };
  // both arrows are the same picture pointing right; the original mirrors the left one in Lua. The arrow's anchor is its left edge, so
  // mirroring it swings it to the left of its position by its own width: move it back
  const left = built.byName.get("left_arrow")!;
  left.setScale(-Math.abs(left.scale.x), left.scale.y, 1);
  left.setPosition(left.position.x + left.getComponent(UITransform)!.width, left.position.y, 0);
  left.on(Node.EventType.TOUCH_END, () => { if (page > 0) { page--; void render(); } });
  built.byName.get("right_arrow")!.on(Node.EventType.TOUCH_END, () => { if (page < pages() - 1) { page++; void render(); } });

  return {
    root,
    setItems(list, equipment = []) { bag = list; equips = equipment; refill(); void render(); },
    show(on) { root.active = on; },
  };
}

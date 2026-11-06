// The backpack page: the original `backpack/backpack_window` with one `goods_item` per slot, five columns by four rows (the quick-sell button sits under the fifth), paged with the
// side arrows. The icon of an item is looked up in the release's item table (tables/items.json: name, icon number, type, quality).
import { HorizontalTextAlignment, Label, Node, Sprite, UITransform } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout } from "./ui";
import { W, H } from "./loginpage";

interface Slot { base_id: number; quantity: number }
type ItemTable = { [id: string]: [string, number, number, number] };

const COLS = 5, ROWS = 4, CELL = 119, GAP = 8;

export interface BackpackPage { root: Node; setItems(items: Slot[]): void; show(on: boolean): void }

export async function buildBackpackPage(canvas: Node): Promise<BackpackPage> {
  const [win, cell, items] = await Promise.all([
    loadJson<LNode>("layouts/backpack/backpack_window.json"),
    loadJson<LNode>("layouts/backpack/goods_item.json"),
    loadJson<ItemTable>("tables/items.json"),
  ]);
  const built = await buildLayout(win, canvas, { hide: ["title_img", "Image_3", "Image_3_0"] });
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  root.active = false;

  // the full-screen background is chosen in Lua at run time; the common fill picture is what it falls back to
  const bg = built.byName.get("background");
  if (bg && !bg.getComponent(Sprite)) {
    const s = bg.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    try { s.spriteFrame = await spriteFrame("ui/common/common_fill_bg.webp"); } catch (e) { console.warn("backpack background:", e); }
    bg.getComponent(UITransform)!.setContentSize(W, H);
  }

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

  let all: Slot[] = [];
  let page = 0;
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
  built.byName.get("left_arrow")!.on(Node.EventType.TOUCH_END, () => { if (page > 0) { page--; void render(); } });
  built.byName.get("right_arrow")!.on(Node.EventType.TOUCH_END, () => { if (page < pages() - 1) { page++; void render(); } });

  return {
    root,
    setItems(list) { all = list; page = 0; void render(); },
    show(on) { root.active = on; },
  };
}

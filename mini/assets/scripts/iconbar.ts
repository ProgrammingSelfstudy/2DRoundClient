// The main city's function icons, placed as MainUiView.setIconPosition does (design coordinates, origin bottom-left, 720x1280): a row of up to
// six under the top bar (type 1), a column down the right edge (type 2) and a row along the bottom right (type 3). Level-opened icons come from
// the table alone; an activity icon shows once the server lists it as open (setPushed).
// Types 3 and 4 (the bottom row and the column above the handle) fold away behind the round "+" handle, as MainUiView.shrinkBtnContainer does.
import { Color, Label, Node, Sprite, UIOpacity, UITransform, tween } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";

// id -> [icon picture, row type, order, name, level to open, open type], from tables/functions.json; open type 1 opens by level alone, 2 (an
// activity) also needs the server to say so
type FunctionTable = { [id: string]: [string, number, number, string, number, number] };
export interface IconBar { root: Node; setLevel(lev: number): void; setPushed(ids: number[]): void; show(on: boolean): void; onIcon(f: (name: string) => void): void }

const TOP_H = 97;
const SKIP = new Set(["111"]); // 游戏中心: opened by the platform's own channel, not shown in the capture
// cell sizes of function_icon_left.csb / function_icon_right.csb, and the gaps MainUiView uses
const LEFT = { w: 74, h: 84 }, RIGHT = { w: 74, h: 74 };

export async function buildIconBar(parent: Node): Promise<IconBar> {
  const table = await loadJson<FunctionTable>("tables/functions.json");
  const root = new Node("icon_bar");
  root.layer = parent.layer;
  root.addComponent(UITransform).setContentSize(0, 0);
  parent.addChild(root);
  let tapped = (_n: string) => {};
  let lev = 0;
  let pushed = new Set<string>();

  // the two folding groups and the handle; the groups hold icons at absolute positions and slide as a whole
  const group = (name: string) => {
    const g = new Node(name);
    g.layer = root.layer;
    g.addComponent(UITransform).setContentSize(0, 0);
    g.addComponent(UIOpacity);
    root.addChild(g);
    return g;
  };
  const row = group("row"), column = group("column");
  const handle = new Node("handle_btn");
  handle.layer = root.layer;
  handle.addComponent(UITransform).setContentSize(79, 79);
  handle.setPosition(675, 168, 0); // display.getRight() - 45, bottom bar height + 60
  const handleSprite = handle.addComponent(Sprite);
  handleSprite.sizeMode = Sprite.SizeMode.CUSTOM;
  atlasFrame("ui/mainui/mainui.json", "mainui_1016.png").then(sf => { handleSprite.spriteFrame = sf; }, () => {});
  root.addChild(handle);
  let folded = false, folding = false;
  const FOLD = 100; // the original moves the row 100 right and the column 100 down while fading, in 0.1 s
  handle.on(Node.EventType.TOUCH_END, () => {
    if (folding) return;
    folding = true;
    folded = !folded;
    row.active = column.active = true;
    const slide = (g: Node, dx: number, dy: number, last: boolean) => {
      const o = g.getComponent(UIOpacity)!, p = g.position;
      const k = folded ? 1 : -1;
      tween(g).to(0.1, { position: p.clone().add3f(dx * k, dy * k, 0) }).call(() => {
        if (folded) g.active = false;
        if (last) folding = false;
      }).start();
      tween(o).to(0.1, { opacity: folded ? 0 : 255 }).start();
    };
    slide(row, FOLD, 0, true);
    slide(column, 0, -FOLD, false);
  });

  const cell = (name: string, res: string, size: { w: number; h: number }, label: boolean) => {
    const n = new Node(name);
    n.layer = root.layer;
    n.addComponent(UITransform).setContentSize(size.w, size.h);
    const pic = new Node("button");
    pic.layer = n.layer;
    pic.addComponent(UITransform);
    const s = pic.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.RAW;
    spriteFrame(`icons/function/${res}.webp`).then(sf => { s.spriteFrame = sf; }, () => {});
    n.addChild(pic);
    if (label) {
      const t = new Node("name");
      t.layer = n.layer;
      t.addComponent(UITransform).setContentSize(size.w, 23);
      const l = t.addComponent(Label);
      l.string = name;
      l.fontSize = 20;
      l.lineHeight = 23;
      l.color = new Color(255, 255, 255, 255);
      l.enableOutline = true;
      l.outlineColor = new Color(60, 30, 10, 255);
      l.outlineWidth = 2;
      t.setPosition(0, 10 - size.h / 2, 0);
      n.addChild(t);
      pic.setPosition(0, 5, 0);
    }
    n.on(Node.EventType.TOUCH_END, () => tapped(name));
    return n;
  };

  const layout = () => {
    row.removeAllChildren();
    column.removeAllChildren();
    for (const n of root.children.slice()) if (n !== row && n !== column && n !== handle) root.removeChild(n);
    const open = Object.entries(table)
      .filter(([id, r]) => !SKIP.has(id) && r[4] <= lev && (r[5] === 1 || pushed.has(id)))
      .map(([, r]) => ({ res: r[0], type: r[1], index: r[2], name: r[3] }))
      .sort((a, b) => a.index - b.index);
    const of = (type: number) => open.filter(o => o.type === type);
    // type 1: container at (607, top bar bottom - 10 + ...) hanging from its top right; the first icon sits at the right and the rest go left
    of(1).forEach((o, i) => {
      const c = cell(o.name, o.res, LEFT, true);
      c.setPosition(607 - LEFT.w / 2 - (i % 6) * (LEFT.w + 15), 1280 - TOP_H + 10 - 90 + 45 - Math.floor(i / 6) * 100, 0);
      root.addChild(c);
    });
    // type 2: the same left-style cell (picture over a name), hung from (709, below the top bar), going down
    of(2).forEach((o, i) => {
      const c = cell(o.name, o.res, LEFT, true);
      c.setPosition(709 - LEFT.w / 2, 1280 - TOP_H - 28 - 90 + 90 - LEFT.h / 2 - i * (LEFT.h + 8), 0);
      root.addChild(c);
    });
    // type 3: a container (79 wide, hanging from x = 618) at the handle's height; the first icon is at its right end, the rest go left, 7 to a line
    of(3).forEach((o, i) => {
      const c = cell(o.name, o.res, RIGHT, false);
      c.setPosition(618 - 79 + 79 - RIGHT.w / 2 - (i % 7) * (RIGHT.w + 20), 168 - Math.floor(i / 7) * 79, 0);
      row.addChild(c);
    });
    // type 4: the column above the handle, from y = 223 going up
    of(4).forEach((o, i) => {
      const c = cell(o.name, o.res, RIGHT, false);
      c.setPosition(675, 223 + RIGHT.h / 2 + i * (RIGHT.h + 20), 0);
      column.addChild(c);
    });
    handle.active = of(3).length + of(4).length > 0;
  };

  return {
    root,
    setLevel(l) { lev = l; layout(); },
    setPushed(ids) { pushed = new Set(ids.map(String)); layout(); },
    show(on) { root.active = on; },
    onIcon(f) { tapped = f; },
  };
}

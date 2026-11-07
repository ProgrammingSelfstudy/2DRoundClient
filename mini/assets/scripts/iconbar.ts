// The main city's function icons, placed as MainUiView.setIconPosition does (design coordinates, origin bottom-left, 720x1280): a row of up to
// six under the top bar (type 1), a column down the right edge (type 2) and a row along the bottom right (type 3). Only the icons the original
// opens by player level are here; the activity icons the server pushes (first charge, seven-day login, ...) are not built yet.
import { Color, Label, Node, Sprite, UITransform } from "cc";
import { loadJson, spriteFrame } from "./cdn";

// id -> [icon picture, row type, order, name, level to open], from tables/functions.json
type FunctionTable = { [id: string]: [string, number, number, string, number] };
export interface IconBar { root: Node; setLevel(lev: number): void; show(on: boolean): void; onIcon(f: (name: string) => void): void }

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
    root.removeAllChildren();
    const open = Object.entries(table)
      .filter(([id, r]) => !SKIP.has(id) && r[4] <= lev)
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
    // type 3: along y = 176, from x = 587 going left (the "+" handle sits to the right of the row)
    of(3).forEach((o, i) => {
      const c = cell(o.name, o.res, RIGHT, false);
      c.setPosition(587 - (i % 7) * (RIGHT.w + 20), 176, 0);
      root.addChild(c);
    });
  };

  return {
    root,
    setLevel(l) { lev = l; layout(); },
    show(on) { root.active = on; },
    onIcon(f) { tapped = f; },
  };
}

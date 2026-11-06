// Builds a UI from a layout tree shipped in the release (layouts/**.json, made from the original .csb by pipeline/csb_tree.py).
// Positions are the original's: in the parent's space with its bottom-left as origin. A Creator child is placed relative to the parent's
// anchor point, so each position is moved by anchor * size of the parent. Every image comes from an atlas of the release.
import { Color, EditBox, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame } from "./cdn";

export interface LRes { slot: number; path: string; plist: string; atlas: string }
export interface LNode {
  class: string;
  name: string;
  pos: number[] | null;
  scale: number[] | null;
  anchor: number[] | null;
  size: number[] | null;
  res: LRes[];
  strings: { slot: number; text: string }[];
  s9: { cap: number[]; size: number[] | null; on: boolean } | null;
  children: LNode[];
}
export interface Built { root: Node; byName: Map<string, Node> }
export interface BuildOptions { hide?: string[]; fontSize?: number; inputFontSize?: number }

export async function buildLayout(tree: LNode, parent: Node, opts: BuildOptions = {}): Promise<Built> {
  const byName = new Map<string, Node>();
  const root = await make(tree, null, parent.layer, byName, opts);
  parent.addChild(root);
  return { root, byName };
}

async function make(n: LNode, p: LNode | null, layer: number, byName: Map<string, Node>, opts: BuildOptions): Promise<Node> {
  const node = new Node(n.name || n.class);
  node.layer = layer;
  const size = n.size ?? [0, 0];
  const anchor = n.anchor ?? [0.5, 0.5];
  const ut = node.addComponent(UITransform);
  ut.setContentSize(size[0], size[1]);
  ut.setAnchorPoint(anchor[0], anchor[1]);
  const pos = n.pos ?? [0, 0];
  const pa = p?.anchor ?? [0.5, 0.5];
  const ps = p?.size ?? [0, 0];
  node.setPosition(pos[0] - pa[0] * ps[0], pos[1] - pa[1] * ps[1], 0);
  if (n.scale) node.setScale(n.scale[0], n.scale[1], 1);
  if (n.name) byName.set(n.name, node);
  if (opts.hide?.indexOf(n.name) !== undefined && opts.hide.indexOf(n.name) >= 0) node.active = false;

  switch (n.class) {
    case "ImageView":
      await addImage(node, n);
      break;
    case "Button":
      await addImage(node, n);
      addText(node, n.strings[0]?.text ?? "", opts.fontSize ?? 28, size);
      break;
    case "TextField":
      addInput(node, n, size, opts.inputFontSize ?? 26);
      break;
    default:
      break; // Node, Panel: a container
  }
  for (const c of n.children) node.addChild(await make(c, n, layer, byName, opts));
  return node;
}

async function addImage(node: Node, n: LNode) {
  const r = n.res[0];
  if (!r || !r.atlas) { console.warn(`ui: ${n.name} has no atlas image`); return; }
  const s = node.addComponent(Sprite);
  s.sizeMode = Sprite.SizeMode.CUSTOM;
  s.type = n.s9?.on ? Sprite.Type.SLICED : Sprite.Type.SIMPLE;
  s.spriteFrame = await atlasFrame(r.atlas, r.path, n.s9?.on ? n.s9.cap : undefined);
  node.getComponent(UITransform)!.setContentSize(n.size![0], n.size![1]); // setting the frame may reset the size
}

function addText(node: Node, text: string, fontSize: number, size: number[]): Label {
  const t = new Node("text");
  t.layer = node.layer;
  t.addComponent(UITransform).setContentSize(size[0], size[1]);
  const l = t.addComponent(Label);
  l.string = text;
  l.fontSize = fontSize;
  l.lineHeight = Math.round(fontSize * 1.3);
  l.color = new Color(255, 255, 255, 255);
  l.horizontalAlign = HorizontalTextAlignment.CENTER;
  l.verticalAlign = VerticalTextAlignment.CENTER;
  l.overflow = Label.Overflow.CLAMP;
  l.enableOutline = true; // LabelOutline is deprecated in 3.8
  l.outlineColor = new Color(90, 50, 10, 255);
  l.outlineWidth = 2;
  node.addChild(t);
  return l;
}

// the original TextField: strings[0] is the placeholder, a node named *password* hides what is typed
function addInput(node: Node, n: LNode, size: number[], fontSize: number) {
  const w = size[0], h = size[1];
  const mk = (name: string, color: Color) => {
    const c = new Node(name);
    c.layer = node.layer;
    const ut = c.addComponent(UITransform);
    ut.setContentSize(w - 8, h);
    ut.setAnchorPoint(0, 1); // EditBox places its labels as if their anchor were the top-left corner
    const l = c.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = h;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.LEFT;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.CLAMP;
    node.addChild(c);
    return l;
  };
  const text = mk("TEXT_LABEL", new Color(40, 30, 20, 255));
  const hint = mk("PLACEHOLDER_LABEL", new Color(150, 130, 110, 255));
  hint.string = n.strings[0]?.text ?? "";
  const eb = node.addComponent(EditBox);
  eb.textLabel = text;
  eb.placeholderLabel = hint;
  eb.maxLength = 32;
  eb.inputMode = EditBox.InputMode.SINGLE_LINE; // the default is multi-line
  eb.returnType = EditBox.KeyboardReturnType.DONE;
  eb.inputFlag = /password/i.test(n.name) ? EditBox.InputFlag.PASSWORD : EditBox.InputFlag.DEFAULT;
  text.verticalAlign = VerticalTextAlignment.CENTER; // EditBox sets the text label to top alignment while it initialises
}

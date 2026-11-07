// A short message over everything, for things that are not built yet ("暂未开放") or that the server refused.
import { Color, HorizontalTextAlignment, Label, Node, UITransform, VerticalTextAlignment } from "cc";
import { W } from "./loginpage";

let current: Node | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(canvas: Node, text: string, ms = 1600): void {
  current?.destroy();
  clearTimeout(timer);
  const n = new Node("toast");
  n.layer = canvas.layer;
  n.addComponent(UITransform).setContentSize(W - 80, 60);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = 30;
  l.lineHeight = 40;
  l.horizontalAlign = HorizontalTextAlignment.CENTER;
  l.verticalAlign = VerticalTextAlignment.CENTER;
  l.overflow = Label.Overflow.SHRINK;
  l.color = new Color(255, 255, 255, 255);
  l.enableOutline = true;
  l.outlineColor = new Color(0, 0, 0, 255);
  l.outlineWidth = 3;
  n.setPosition(0, 120, 0);
  canvas.addChild(n);
  current = n;
  timer = setTimeout(() => { if (current === n) { n.destroy(); current = null; } }, ms);
}

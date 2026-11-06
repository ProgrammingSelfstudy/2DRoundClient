// The login page. 720x1280 portrait like the original; everything is built in code from CDN images and Graphics, so the scene stays empty.
import { Color, EditBox, Graphics, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { spriteFrame } from "./cdn";

export const W = 720;
export const H = 1280;

const rgba = (r: number, g: number, b: number, a = 255) => new Color(r, g, b, a);

function child(parent: Node | null, name: string, x = 0, y = 0, w = 0, h = 0): Node {
  const n = new Node(name);
  if (parent) { n.layer = parent.layer; parent.addChild(n); }
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(w, h);
  return n;
}

function roundRect(n: Node, w: number, h: number, r: number, fill: Color) {
  const g = n.getComponent(Graphics) ?? n.addComponent(Graphics);
  g.clear();
  g.fillColor = fill;
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
}

function label(parent: Node | null, text: string, size: number, color: Color, w: number, h: number, align = HorizontalTextAlignment.CENTER): Label {
  const n = child(parent, "label", 0, 0, w, h);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.3);
  l.color = color;
  l.horizontalAlign = align;
  l.verticalAlign = VerticalTextAlignment.CENTER;
  l.overflow = Label.Overflow.CLAMP;
  return l;
}

function input(parent: Node, y: number, placeholder: string, password: boolean, value: string): EditBox {
  const w = 540, h = 84;
  const n = child(null, "input", 0, y, w, h);
  n.layer = parent.layer;
  // the background is a child: EditBox adds its own Sprite to its node, and a node may hold only one renderable
  roundRect(child(n, "bg", 0, 0, w, h), w, h, 16, rgba(255, 255, 255, 235));
  const text = label(n, "", 34, rgba(30, 30, 30), w - 40, h, HorizontalTextAlignment.LEFT);
  const hint = label(n, placeholder, 34, rgba(130, 130, 130), w - 40, h, HorizontalTextAlignment.LEFT);
  text.node.name = "TEXT_LABEL";
  hint.node.name = "PLACEHOLDER_LABEL";
  // EditBox places its labels as if their anchor were the top-left corner; with the default centre anchor they sit half outside the box
  for (const l of [text, hint]) l.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
  const eb = n.addComponent(EditBox); // the labels are in place before the node is attached, so the component finds them
  eb.textLabel = text;
  eb.placeholderLabel = hint;
  eb.maxLength = 32;
  eb.inputFlag = password ? EditBox.InputFlag.PASSWORD : EditBox.InputFlag.DEFAULT;
  eb.string = value;
  parent.addChild(n);
  return eb;
}

export interface LoginPage {
  account: EditBox;
  password: EditBox;
  setStatus(text: string, error?: boolean): void;
  setBusy(busy: boolean): void;
  onLogin(f: () => void): void;
  setFooter(text: string): void;
}

export async function buildLoginPage(canvas: Node, account: string, password: string): Promise<LoginPage> {
  const root = child(canvas, "login", 0, 0, W, H);

  // background and logo come from the release manifest; the page still works (plain colour) if one cannot be loaded
  try {
    const bg = child(root, "bg", 0, 0, W, H);
    const s = bg.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.spriteFrame = await spriteFrame("boot/first_loading_bg.webp");
    bg.getComponent(UITransform)!.setContentSize(W, H);
  } catch (e) {
    roundRect(child(root, "bg", 0, 0, W, H), W, H, 0, rgba(20, 40, 80));
    console.error("login background:", e);
  }
  try {
    const logo = child(root, "logo", 0, 330, 560, 376);
    const ls = logo.addComponent(Sprite);
    ls.sizeMode = Sprite.SizeMode.CUSTOM;
    ls.spriteFrame = await spriteFrame("boot/txt_cn_logo.webp");
    logo.getComponent(UITransform)!.setContentSize(560, 376);
  } catch (e) {
    console.error("login logo:", e);
  }
  const shade = child(root, "shade", 0, -250, 620, 520);
  roundRect(shade, 620, 520, 28, rgba(0, 0, 0, 120));

  const acct = input(root, -110, "账号", false, account);
  const pass = input(root, -220, "密码", true, password);

  const button = child(root, "button", 0, -345, 380, 92);
  roundRect(button, 380, 92, 46, rgba(255, 150, 30));
  const buttonLabel = label(button, "登录", 40, rgba(255, 255, 255), 380, 92);

  const status = label(root, "", 28, rgba(255, 255, 255), 600, 80);
  status.node.setPosition(0, -440, 0);
  const footer = label(root, "", 22, rgba(255, 255, 255, 200), 600, 40);
  footer.node.setPosition(0, -488, 0); // inside the panel: the background has a logo at the bottom

  let busy = false;
  let handler = () => {};
  button.on(Node.EventType.TOUCH_END, () => { if (!busy) handler(); });

  return {
    account: acct,
    password: pass,
    setStatus: (text, error = false) => { status.string = text; status.color = error ? rgba(255, 110, 110) : rgba(255, 255, 255); },
    setBusy: b => { busy = b; buttonLabel.string = b ? "登录中…" : "登录"; roundRect(button, 380, 92, 46, b ? rgba(170, 170, 170) : rgba(255, 150, 30)); },
    onLogin: f => { handler = f; },
    setFooter: t => { footer.string = t; }
  };
}

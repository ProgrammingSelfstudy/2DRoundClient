// The login page. The panel (account, password, the buttons) is the original's `login/user_panel`, built from its layout in the release;
// background and logo are original images of the release too. 720x1280 portrait like the original.
import { Color, EditBox, Graphics, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment, view } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout } from "./ui";

export const W = 720;
export const H = 1280;

const rgba = (r: number, g: number, b: number, a = 255) => new Color(r, g, b, a);

function child(parent: Node, name: string, x = 0, y = 0, w = 0, h = 0): Node {
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(w, h);
  return n;
}

function text(parent: Node, s: string, size: number, color: Color, w: number, h: number): Label {
  const n = child(parent, "label", 0, 0, w, h);
  const l = n.addComponent(Label);
  l.string = s;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.3);
  l.color = color;
  l.horizontalAlign = HorizontalTextAlignment.CENTER;
  l.verticalAlign = VerticalTextAlignment.CENTER;
  l.overflow = Label.Overflow.CLAMP;
  l.enableOutline = true; // the page text sits on a busy picture
  l.outlineColor = rgba(0, 0, 0, 255);
  l.outlineWidth = 3;
  return l;
}

export interface LoginPage {
  account: EditBox;
  password: EditBox;
  setStatus(text: string, error?: boolean): void;
  setBusy(busy: boolean): void;
  onLogin(f: () => void): void;
  onRegister(f: () => void): void;
  setFooter(text: string): void;
  setNote(text: string): void; // stays on screen: what the player has to write down (the made-up account and password)
  relayout(): void; // call after the window size changed
}

export async function buildLoginPage(canvas: Node, account: string, password: string): Promise<LoginPage> {
  const root = child(canvas, "login", 0, 0, W, H);

  // the background covers the whole visible area (cropped, not stretched), which is taller than the design on a tall phone
  let bgNode: Node | null = null;
  const cover = () => {
    if (!bgNode) return;
    const vs = view.getVisibleSize();
    const k = Math.max(vs.width / W, vs.height / H);
    bgNode.getComponent(UITransform)!.setContentSize(W * k, H * k);
  };
  try {
    const bg = child(root, "bg", 0, 0, W, H);
    bgNode = bg;
    const s = bg.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.spriteFrame = await spriteFrame("boot/first_loading_bg.webp");
    cover();
  } catch (e) {
    const g = child(root, "bg", 0, 0, W, H).addComponent(Graphics);
    g.fillColor = rgba(20, 40, 80);
    g.rect(-W / 2, -H / 2, W, H);
    g.fill();
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

  // the original panel, 500x360, its bottom-left corner placed so the panel sits in the lower middle
  let acct: EditBox | null = null, pass: EditBox | null = null;
  let bLogin: Node | null = null, bRegist: Node | null = null, loginText: Label | null = null;
  try {
    const layout = await loadJson<LNode>("layouts/login/user_panel.json"); // the file is the tree itself
    const built = await buildLayout(layout, root, { hide: ["btn_mail"] });
    built.root.setPosition(-250, -400, 0);
    acct = built.byName.get("user_name_input")!.getComponent(EditBox);
    pass = built.byName.get("password_input")!.getComponent(EditBox);
    bLogin = built.byName.get("btn_login") ?? null;
    bRegist = built.byName.get("btn_regist") ?? null;
    loginText = bLogin?.getChildByName("text")?.getComponent(Label) ?? null;
  } catch (e) {
    console.error("login panel:", e);
  }
  if (!acct || !pass) throw new Error("登录面板没有加载出来");
  acct.string = account;
  pass.string = password;

  const note = text(root, "", 26, rgba(255, 230, 120), 680, 70);
  note.node.setPosition(0, -440, 0);
  const status = text(root, "", 28, rgba(255, 255, 255), 640, 80);
  status.node.setPosition(0, -505, 0);
  const footer = text(root, "", 22, rgba(255, 255, 255, 210), 600, 40);
  footer.node.setPosition(0, -560, 0);

  let busy = false;
  let onLogin = () => {}, onRegister = () => {};
  // a button gives feedback by shrinking a little while it is held, as the original's zoom transition does
  const press = (b: Node | null, f: () => void) => {
    if (!b) return;
    b.on(Node.EventType.TOUCH_START, () => b.setScale(0.94, 0.94, 1));
    b.on(Node.EventType.TOUCH_CANCEL, () => b.setScale(1, 1, 1));
    b.on(Node.EventType.TOUCH_END, () => { b.setScale(1, 1, 1); if (!busy) f(); });
  };
  press(bLogin, () => onLogin());
  press(bRegist, () => onRegister());

  return {
    account: acct,
    password: pass,
    setStatus: (t, error = false) => { status.string = t; status.color = error ? rgba(255, 110, 110) : rgba(255, 255, 255); },
    setBusy: b => { busy = b; if (loginText) loginText.string = b ? "登陆中…" : "登陆"; for (const n of [bLogin, bRegist]) n?.getComponent(Sprite) && (n.getComponent(Sprite)!.grayscale = b); },
    onLogin: f => { onLogin = f; },
    onRegister: f => { onRegister = f; },
    setFooter: t => { footer.string = t; },
    setNote: t => { note.string = t; },
    relayout: cover
  };
}

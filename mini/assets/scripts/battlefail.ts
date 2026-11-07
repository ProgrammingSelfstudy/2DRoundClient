// The defeat window of a campaign fight: the original `battle/battle_fail_view` (BattleFailView), opened when the server's 13016 says the fight was lost.
// A dark band over the field with the title, "失败，不要气馁，…", "当前战斗：剧情副本", a confirm button and the 10-second countdown that also confirms.
// Left out for now: the title's Spine effect (104; the title is plain text), the "变强小助手" button and the improvement entries it names, the
// "back to the mode" button and the damage statistics window.
import { Color, Graphics, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson } from "./cdn";
import { LNode, buildLayout, blockInput } from "./ui";

export interface FailWindow { root: Node; open(): Promise<void> }

const CLOSE_SECONDS = 10;

export async function buildFailWindow(canvas: Node): Promise<FailWindow> {
  const layout = await loadJson<LNode>("layouts/battle/battle_fail_view.json");
  const built = await buildLayout(layout, canvas, { hide: ["harm_btn"] });
  const root = built.root;
  root.setPosition(-360, -640, 0);
  blockInput(root, 720, 1280);
  root.active = false;
  const container = built.byName.get("container")!; // anchored in the middle, 720 x 505

  // black_panel is a plain dark panel in the layout (a solid colour, which the layout builder does not draw): the band behind the text
  const band = new Node("band");
  band.layer = container.layer;
  band.addComponent(UITransform);
  const bg = band.addComponent(Graphics);
  bg.fillColor = new Color(0, 0, 0, 190);
  bg.rect(-360, -252.5, 720, 505);
  bg.fill();
  container.addChild(band);
  band.setSiblingIndex(0);

  const text = (str: string, x: number, y: number, size: number, color: Color, outline?: Color) => {
    const n = new Node("label");
    n.layer = container.layer;
    n.addComponent(UITransform).setContentSize(560, size * 2 + 16);
    const l = n.addComponent(Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 6;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.NONE;
    l.color = color;
    if (outline) { l.enableOutline = true; l.outlineColor = outline; l.outlineWidth = 2; }
    n.setPosition(x, y, 0);
    container.addChild(n);
    return l;
  };
  const white = new Color(255, 255, 255, 255), dark = new Color(2, 0, 25, 255);
  // positions are the Lua's (relative to the container's bottom-left) moved by half its size
  text("战斗失败", 0, 252.5 + 40, 64, new Color(200, 205, 230, 255), dark);
  text("失败，不要气馁，\n可通过以下方式提升实力！", 0, 345 - 252.5, 20, white, dark);
  text("当前战斗：剧情副本", 0, 410 - 252.5, 24, new Color(255, 238, 172, 255));
  const timeLabel = text("", 0, 20 - 252.5, 22, white);

  const btn = new Node("confirm_btn");
  btn.layer = container.layer;
  btn.addComponent(UITransform).setContentSize(162, 62);
  const bs = btn.addComponent(Sprite);
  bs.sizeMode = Sprite.SizeMode.CUSTOM;
  atlasFrame("ui/common/common.json", "common_1017.png", [17, 17, 24, 17]).then(sf => { bs.spriteFrame = sf; }, () => {});
  btn.setPosition(0, -80 - 252.5, 0);
  container.addChild(btn);
  const label = (() => { const l = text("确定", 0, 0, 24, white, new Color(118, 69, 25, 255)); btn.addChild(l.node); l.node.setPosition(0, 0, 0); return l; })();
  void label;

  let done: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    clearInterval(timer);
    root.active = false;
    done?.();
    done = undefined;
  };
  btn.on(Node.EventType.TOUCH_END, close);

  return {
    root,
    open() {
      let left = CLOSE_SECONDS;
      timeLabel.string = `${left}秒后关闭`;
      clearInterval(timer);
      timer = setInterval(() => {
        left -= 1;
        timeLabel.string = `${left}秒后关闭`;
        if (left <= 0) close();
      }, 1000);
      root.setSiblingIndex(root.parent!.children.length - 1);
      root.active = true;
      return new Promise<void>(res => { done = res; });
    },
  };
}

// The main city's backdrop: the original's full-screen static picture (centerscene/centercity_2). The original draws a tiled map with
// animated Spine on top of it; that comes later. Like the login background it covers the whole visible area, cropped rather than stretched.
import { Node, Sprite, UITransform, view } from "cc";
import { spriteFrame } from "./cdn";
import { W, H } from "./loginpage";

export async function buildCityBackground(canvas: Node): Promise<{ root: Node; relayout(): void }> {
  const root = new Node("city_bg");
  root.layer = canvas.layer;
  root.addComponent(UITransform).setContentSize(W, H);
  canvas.addChild(root);
  const s = root.addComponent(Sprite);
  s.sizeMode = Sprite.SizeMode.CUSTOM;
  const relayout = () => {
    const vs = view.getVisibleSize();
    const k = Math.max(vs.width / W, vs.height / H);
    root.getComponent(UITransform)!.setContentSize(W * k, H * k);
  };
  try { s.spriteFrame = await spriteFrame("bg/centercity_2.webp"); } catch (e) { console.warn("city background:", e); }
  relayout();
  return { root, relayout };
}

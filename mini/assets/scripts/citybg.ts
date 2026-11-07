// The main city's scene: four layers of the original (scene/centercity/{4,3,2}; layer 1 is hidden in the original) placed as
// CenterCityScene.renderMapPic does, in scene coordinates (origin bottom-left, 1280 high): layer 2 at (0,60) and layer 3 at (0,502) with their
// bottom-left corners, layer 4 hung from the top-left corner at (0,1280). Drag sideways to look around. Drawn bottom to top: 4, 3, 2.
import { Color, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment, view } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { W, H } from "./loginpage";

const SCENE_H = 1280;
const SCENE_W = 2012; // the widest layer
const LAYERS: { n: number; x: number; y: number; ax: number; ay: number }[] = [
  { n: 4, x: 0, y: SCENE_H, ax: 0, ay: 1 },
  { n: 3, x: 0, y: 502, ax: 0, ay: 0 },
  { n: 2, x: 0, y: 60, ax: 0, ay: 0 },
];

interface Building { bid: number; layer: number; name: string; res: number; x: number; y: number }
export interface CityScene { root: Node; scene: Node; relayout(): void; scrollTo(x: number): void; onBuilding(f: (b: Building) => void): void }

// buildings the original draws mirrored (BuildItem.createBuild): crossshow, luckytreasure, startower, adventure, seerpalace, resonate
// are not in the main city's list, so none of the seven here is mirrored
const ATLAS = "ui/centerscene/centerscene.json";

export async function buildCityScene(canvas: Node): Promise<CityScene> {
  const root = new Node("city_scene");
  root.layer = canvas.layer;
  root.addComponent(UITransform).setContentSize(W, H);
  canvas.addChild(root);
  // `scene` holds the layers in scene coordinates; it is moved to scroll and scaled to fill the window's height
  const scene = new Node("scene");
  scene.layer = root.layer;
  scene.addComponent(UITransform).setContentSize(SCENE_W, SCENE_H);
  scene.getComponent(UITransform)!.setAnchorPoint(0, 0);
  root.addChild(scene);

  let offset = 0; // scene x shown at the left edge of the window
  const apply = () => {
    const vs = view.getVisibleSize();
    const k = Math.max(vs.height / SCENE_H, 1);
    const maxOff = Math.max(0, SCENE_W - vs.width / k);
    offset = Math.min(maxOff, Math.max(0, offset));
    scene.setScale(k, k, 1);
    scene.setPosition(-vs.width / 2 - offset * k, -vs.height / 2, 0);
  };
  await Promise.all(LAYERS.map(async l => {
    const n = new Node(`layer${l.n}`);
    n.layer = root.layer;
    const ut = n.addComponent(UITransform);
    ut.setAnchorPoint(l.ax, l.ay);
    const s = n.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.RAW;
    try { s.spriteFrame = await spriteFrame(`scene/centercity/${l.n}.webp`); } catch (e) { console.warn(`scene layer ${l.n}:`, e); }
    n.setPosition(l.x, l.y, 0);
    scene.addChild(n);
    n.setSiblingIndex(LAYERS.indexOf(l)); // LAYERS is listed bottom to top: 4, 3, 2
  }));

  let dragged = 0; // a touch that moved is a scroll, not a tap on a building
  root.on(Node.EventType.TOUCH_START, () => { dragged = 0; });
  root.on(Node.EventType.TOUCH_MOVE, (e: { getUIDelta(): { x: number; y: number } }) => {
    const k = scene.scale.x;
    dragged += Math.abs(e.getUIDelta().x) + Math.abs(e.getUIDelta().y);
    offset -= e.getUIDelta().x / k;
    apply();
  });

  // the buildings: the original's plate (a round background and the name written on it) at the position in tables/city.json
  let tapped = (_b: Building) => {};
  try {
    const city = await loadJson<{ buildings: Building[] }>("tables/city.json");
    for (const b of city.buildings) {
      const node = new Node(`build_${b.bid}`);
      node.layer = root.layer;
      node.addComponent(UITransform).setContentSize(72, 80);
      node.setPosition(b.x, b.y, 0);
      const part = async (name: string, frame: string, dy: number) => {
        const n = new Node(name);
        n.layer = root.layer;
        n.addComponent(UITransform);
        n.setPosition(0, dy, 0);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.TRIMMED;
        sp.spriteFrame = await atlasFrame(ATLAS, `${frame}.png`);
        node.addChild(n);
      };
      await part("bg", "scene_icon_bg_1", 0);
      await part("name", `txt_cn_scene_${b.res}`, 6);
      node.on(Node.EventType.TOUCH_END, () => { if (dragged < 12) tapped(b); });
      scene.addChild(node);
    }
  } catch (e) { console.warn("city buildings:", e); }
  offset = 480; // what the original shows first: the ship at the left of the screen
  apply();
  return { root, scene, relayout: apply, scrollTo: x => { offset = x; apply(); }, onBuilding: f => { tapped = f; } };
}

// The main city page: the original `mainui/mainui_view` (top bar with head, level, power and currencies; bottom tab bar) built from its
// layout in the release, filled from the main-city data the server sent. The city scene behind it and the tabs' pages come later.
import { Label, Mask, Node, Sprite, UITransform } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout } from "./ui";
import { W, H } from "./loginpage";
import { IconBar, buildIconBar } from "./iconbar";
import { spineNode } from "./spine";
import type { City } from "./shared/city";

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${Math.floor(n / 1e4)}万` : String(n);
};

export interface MainPage { root: Node; icons: IconBar; setCity(c: City): void; select(tab: number): void; onTab(f: (tab: number) => void): void }

export async function buildMainPage(canvas: Node): Promise<MainPage> {
  const layout = await loadJson<LNode>("layouts/mainui/mainui_view.json");
  const built = await buildLayout(layout, canvas, {
    hide: ["hide_container", "prompt_container", "icon_container", "tips_point", "selected", "notice"],
    panelImages: true,
  });
  const by = built.byName;
  built.root.setPosition(-W / 2, -H / 2, 0); // the layout's origin is its bottom-left corner
  const label = (n: string) => by.get(n)?.getComponent(Label);
  const tabs = [1, 2, 3, 4, 5, 6, 7].map(i => by.get(`mainui_tab_${i}`)!);
  const icons = await buildIconBar(built.root);
  let handler = (_t: number) => {};
  // the centre button's picture is a Spine effect (E51130) the original puts into its empty `icon` node: action1 idle, action2 selected
  let tabNow = 4;
  let centre: Awaited<ReturnType<typeof spineNode>> | null = null;
  spineNode("spine/fx/E51130/action", "action1", by.get("mainui_tab_4")!.getChildByName("icon")!).then(s => {
    centre = s;
    s.node.setPosition(0, 5, 0); // the original puts it at (5, 10) of the 10x10 icon node, whose own anchor is its centre
    s.node.setScale(1.3, 1.3, 1);
    s.setAnimation(0, tabNow === 4 ? "action2" : "action1", true);
  }, e => console.warn(`centre button: ${(e as Error).message}`));
  const select = (t: number) => {
    tabNow = t;
    centre?.setAnimation(0, t === 4 ? "action2" : "action1", true);
    icons.show(t === 4); // the function icons belong to the main city; the pages cover it
    tabs.forEach((n, i) => {
      const sel = n.getChildByName("selected");
      if (sel) sel.active = i + 1 === t;
    });
  };
  tabs.forEach((n, i) => {
    n.on(Node.EventType.TOUCH_END, () => { select(i + 1); handler(i + 1); });
  });
  select(4); // the centre tab is the main city

  // the head: the original's circular PlayerHead, a headicon picture cut to a circle inside head_container (80x80)
  const holder = by.get("head_container")!;
  const circle = new Node("head_circle");
  circle.layer = holder.layer;
  circle.addComponent(UITransform).setContentSize(76, 76);
  circle.setPosition(0, 0, 0);
  circle.addComponent(Mask).type = Mask.Type.GRAPHICS_ELLIPSE;
  const pic = new Node("pic");
  pic.layer = holder.layer;
  pic.addComponent(UITransform).setContentSize(76, 76);
  const headSprite = pic.addComponent(Sprite);
  headSprite.sizeMode = Sprite.SizeMode.CUSTOM;
  circle.addChild(pic);
  holder.addChild(circle);
  const vip = new Node("vip_lev");
  vip.layer = holder.layer;
  vip.addComponent(UITransform).setContentSize(60, 24);
  vip.setPosition(-4, 18, 0);
  const vipLabel = vip.addComponent(Label);
  vipLabel.fontSize = 18;
  vipLabel.lineHeight = 22;
  vipLabel.enableOutline = true;
  vipLabel.outlineWidth = 2;
  holder.addChild(vip);
  return {
    root: built.root,
    select,
    icons,
    onTab: f => { handler = f; },
    setCity(c) {
      const r = (c.role ?? {}) as Record<string, unknown>;
      const a = (c.assets ?? {}) as Record<string, unknown>;
      if (label("name_label")) label("name_label")!.string = String(r.name ?? "");
      if (label("lev_label")) label("lev_label")!.string = String(r.lev ?? "");
      icons.setPushed((c.icons ?? []) as number[]);
      icons.setLevel(Number(new URLSearchParams(location.search).get("lev") ?? r.lev ?? 0)); // ?lev= is a dev override to see higher-level icons
      if (label("fight_label")) label("fight_label")!.string = num(r.power);
      // the bar shows three currencies (icons of items 2, 3 and 41); which 10302 field the third is has not been matched to the original yet
      label("wealth_label_1")!.string = num(a.coin);
      label("wealth_label_2")!.string = num(a.gold);
      label("wealth_label_3")!.string = num(a.hero_exp);
      vipLabel.string = Number(r.vip_lev ?? 0) > 0 ? String(r.vip_lev) : "";
      spriteFrame(`icons/head/${r.face_id}.webp`).then(sf => { headSprite.spriteFrame = sf; }, () => {}); // a face_id with no picture keeps the empty circle
      const max = Number(r.exp_max ?? 0), cur = Number(r.exp ?? 0);
      const bar = by.get("exp_bar")?.getComponent(Sprite);
      if (bar && max > 0) bar.fillRange = Math.min(1, cur / max);
    },
  };
}

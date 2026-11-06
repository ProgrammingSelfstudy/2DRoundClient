// The main city page: the original `mainui/mainui_view` (top bar with head, level, power and currencies; bottom tab bar) built from its
// layout in the release, filled from the main-city data the server sent. The city scene behind it and the tabs' pages come later.
import { Label, Node, Sprite } from "cc";
import { loadJson } from "./cdn";
import { LNode, buildLayout } from "./ui";
import { W, H } from "./loginpage";
import type { City } from "./shared/city";

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${Math.floor(n / 1e4)}万` : String(n);
};

export interface MainPage { root: Node; setCity(c: City): void; select(tab: number): void; onTab(f: (tab: number) => void): void }

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
  let handler = (_t: number) => {};
  const select = (t: number) => {
    tabs.forEach((n, i) => {
      const sel = n.getChildByName("selected");
      if (sel) sel.active = i + 1 === t;
    });
  };
  tabs.forEach((n, i) => {
    n.on(Node.EventType.TOUCH_END, () => { select(i + 1); handler(i + 1); });
  });
  select(4); // the centre tab is the main city
  return {
    root: built.root,
    select,
    onTab: f => { handler = f; },
    setCity(c) {
      const r = (c.role ?? {}) as Record<string, unknown>;
      const a = (c.assets ?? {}) as Record<string, unknown>;
      if (label("name_label")) label("name_label")!.string = String(r.name ?? "");
      if (label("lev_label")) label("lev_label")!.string = String(r.lev ?? "");
      if (label("fight_label")) label("fight_label")!.string = num(r.power);
      // the bar shows three currencies (icons of items 2, 3 and 41); which 10302 field the third is has not been matched to the original yet
      label("wealth_label_1")!.string = num(a.coin);
      label("wealth_label_2")!.string = num(a.gold);
      label("wealth_label_3")!.string = num(a.hero_exp);
      const max = Number(r.exp_max ?? 0), cur = Number(r.exp ?? 0);
      const bar = by.get("exp_bar")?.getComponent(Sprite);
      if (bar && max > 0) bar.fillRange = Math.min(1, cur / max);
    },
  };
}

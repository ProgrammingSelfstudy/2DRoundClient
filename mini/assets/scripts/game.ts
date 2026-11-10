// The game after login: the main city under everything, the top bar and the bottom tabs over the pages, and the pages of the tabs. Each feature
// (heroes, campaign, ...) defines its own windows and talks to the server itself; this file only puts them together.
import { Node, screen } from "cc";
import { App, attempt } from "./app";
import { buildBackpackPage } from "./backpackpage";
import { campaignFeature } from "./campaign";
import { buildCityScene } from "./citybg";
import { devtools } from "./devtools";
import { formationFeature } from "./formation";
import { heroFeature } from "./heroes";
import { buildMainPage } from "./mainpage";
import type { Win } from "./windows";

export async function enterCity(app: App): Promise<void> {
  const { store, windows, query } = app;

  const city = await buildCityScene(windows.layer("scene"));
  screen.on("window-resize", city.relayout);
  city.onBuilding(bd => app.toast(`${bd.name.replace("图标", "")}：暂未开放`)); // no building opens a page yet: say which one was tapped

  const formation = formationFeature(app);
  const campaign = campaignFeature(app, formation);
  const heroes = heroFeature(app, formation, campaign.battle);
  const bag = windows.define("page", async parent => {
    const b = await buildBackpackPage(parent);
    store.follow("bag", () => b.setItems(store.items, store.equips));
    return b;
  }, w => w.show(false));

  const main = await buildMainPage(windows.layer("bar"));
  const devLev = query.get("lev"); // ?lev= is a dev override to see the icons of a higher level
  let iconLev = -1;
  store.follow("role", () => {
    main.setRole(store.role);
    const lev = Number(devLev ?? store.role.lev);
    if (lev !== iconLev) main.icons.setLevel((iconLev = lev)); // the icon bar is laid out again only when the level changes
  });
  store.follow("assets", () => main.setAssets(store.assets));
  store.follow("icons", () => main.icons.setPushed(store.icons));
  main.icons.onIcon(name => app.toast(`${name}：暂未开放`));

  // tab 1 is the main city, 2 the heroes, 3 the backpack, 4 the stages; the other tabs have no page yet
  const pages: { [tab: number]: Win<{ root: Node; show(on: boolean): void }> } = { 2: heroes.page, 3: bag, 4: campaign.page };
  let tab = 1;
  main.onTab(t => {
    tab = t;
    windows.hideLayer("full");
    windows.hideLayer("page");
    const page = pages[t];
    if (!page) return;
    if (t === 2) store.refreshHeroes().catch(e => console.warn("hero list:", (e as Error).message));
    attempt(app, async () => {
      const p = await page.get();
      if (tab === t) p.show(true); // the player may have gone to another tab while the page was being built
    });
  });

  devtools(app, campaign);
}

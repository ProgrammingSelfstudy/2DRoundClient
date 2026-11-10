// The heroes: the hero page of the second tab, the hero info window (11063 fills its attributes) and the library.
import { App, attempt } from "./app";
import type { FormationFeature } from "./formation";
import { buildHeroDetail } from "./herodetail";
import { buildHeroLibrary } from "./herolibrary";
import { HeroPage, buildHeroPage } from "./heropage";
import type { BattleScene } from "./battlescene";
import { buildSkillPreview } from "./skillpreview";
import type { Win } from "./windows";

export interface HeroFeature { page: Win<HeroPage> }

export function heroFeature(app: App, formation: FormationFeature, battle: Win<BattleScene>): HeroFeature {
  const { session, store, windows } = app;

  // the skill preview over everything: the battle scene (the campaign's) casts the hero's skills at a dummy; closing it gives the scene its tap-to-leave back
  const preview = windows.define("popup", async parent => buildSkillPreview(parent, await battle.get(), () => {
    const b = battle.ready();
    b?.onTap(() => b.show(false));
  }), w => { if (w.root.active) w.close(); });

  const detail = windows.define("full", async parent => {
    const d = await buildHeroDetail(parent);
    d.onPreview(h => attempt(app, async () => (await preview.front()).open(h.bid, h.star)));
    // the level button: 11003 raises the hero (the server pushes 11002 first, which the store takes), then the window shows the hero again
    d.onLevelUp(h => attempt(app, async () => {
      const r = await session.request(11003, { partner_id: h.partner_id }, 11003) as { result?: number; msg?: string };
      if (Number(r.result) !== 1) { app.toast(String(r.msg || "升级失败")); return; }
      const now = store.heroes.find(x => x.partner_id === h.partner_id) ?? h;
      d.open(now, null);
      d.setAttrs(h.partner_id, await session.request(11063, { partner_id: h.partner_id }, 11063) as never);
    }));
    return d;
  }, w => w.close());

  const library = windows.define("full", async parent => {
    const lib = await buildHeroLibrary(parent);
    // a card of the library opens the hero info window with the hero at its initial star (no attributes: it is nobody's hero)
    lib.onHero((bid, star) => attempt(app, async () => (await detail.front()).open({ partner_id: 0, bid, lev: 1, star, power: 0 }, null)));
    return lib;
  }, w => w.close());

  const page = windows.define("page", async parent => {
    const p = await buildHeroPage(parent);
    store.follow("heroes", () => p.setHeroes(store.heroes, store.heroCap));
    p.onTab(i => {
      if (i === 1) attempt(app, async () => (await library.front()).open());
      else if (i !== 0) app.toast("暂未开放");
    });
    // tapping a hero opens its info window at once with what the list has, then fills the attribute list from 11063
    p.onHero(h => attempt(app, async () => {
      const d = await detail.front();
      d.open(h, null);
      d.setAttrs(h.partner_id, await session.request(11063, { partner_id: h.partner_id }, 11063) as never);
    }));
    p.onEmbattle(() => attempt(app, () => formation.open()));
    return p;
  }, w => w.show(false));

  return { page };
}

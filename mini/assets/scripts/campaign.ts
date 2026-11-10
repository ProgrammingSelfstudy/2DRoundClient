// The campaign: the stage page of the centre tab, the quick battle and its reward window, and a fight from the boss button to its result.
//   boss button -> formation window -> 13003 (code 1: the fight starts) -> 20027 ... 13016 (see battleflow.ts) -> the win or the defeat window
// The new stage after a win (13001) and what the fight paid (10302) reach the pages through the store.
import { App, attempt } from "./app";
import { Feed, runFight } from "./battleflow";
import { buildFailWindow } from "./battlefail";
import { buildMvpWindow } from "./battlemvp";
import { buildBattleScene } from "./battlescene";
import { FIRST_STAGE, chapterMap } from "./design";
import { DramaPage, buildDramaPage } from "./dramapage";
import type { FormationFeature } from "./formation";
import { buildHookReward } from "./hookreward";
import { buildQuickWindow } from "./quickwindow";

export function campaignFeature(app: App, formation: FormationFeature) {
  const { session, store, windows } = app;
  // the frames of a fight are queued from the moment they arrive: the scene may still be loading when the server sends the first ones
  const feed = new Feed(session, [20027, 20002, 20004, 13016]);

  const battle = windows.define("battle", async parent => {
    const b = await buildBattleScene(parent);
    b.onTap(() => b.show(false)); // no controls yet: a tap goes back to the stage page
    return b;
  }, w => w.show(false));
  const mvp = windows.define("popup", buildMvpWindow, w => { w.root.active = false; }); // 13016: the win window
  const fail = windows.define("popup", buildFailWindow, w => { w.root.active = false; }); // 13016 with result 2: the defeat window
  const reward = windows.define("popup", buildHookReward, w => w.close()); // 13007: what a quick battle or a hook claim paid
  const quick = windows.define("popup", async parent => {
    const q = await buildQuickWindow(parent);
    q.onQuick(() => attempt(app, async () => {
      const reply = await session.request(13004, {}, 13004);
      app.toast(String(reply.msg ?? ""));
    }));
    return q;
  }, w => w.close());
  session.on(13006, m => quick.ready()?.setQuick(m)); // after a quick battle the server pushes the new count
  session.on(13007, m => { quick.hide(); attempt(app, async () => (await reward.front()).open(m)); });

  let fighting = false;
  const fight = async () => {
    if (fighting) return;
    fighting = true;
    try {
      feed.clear();
      const reply = await session.request(13003, { is_auto: 0 }, 13003);
      if (Number(reply.code) !== 1) return app.toast(String(reply.msg ?? "")); // no fight: the server says why
      const opening = (await feed.take([20027])).msg;
      const scene = await battle.front();
      const result = await runFight(session, feed, scene, opening, chapterMap(Number(store.drama?.chapter_id ?? 0)));
      // the win or the defeat window over the battle, then back to the stage page
      if (Number(result.result) === 1) await (await mvp.front()).open(result);
      else await (await fail.front()).open();
      scene.show(false);
    } finally {
      fighting = false;
    }
  };
  const nextChapter = async () => {
    const reply = await session.request(13002, {}, 13002);
    app.toast(String(reply.msg ?? ""));
  };

  const page = windows.define<DramaPage>("page", async parent => {
    const p = await buildDramaPage(parent);
    const draw = () => p.setDrama(store.drama, store.role.lev);
    store.follow("drama", draw);
    let lev = store.role.lev;
    store.watch("role", () => { if (store.role.lev !== lev) { lev = store.role.lev; draw(); } }); // the boss button depends on the level
    p.onBoss(a => {
      if (a === "level") return app.toast("等级不足");
      attempt(app, a === "next" ? nextChapter : () => formation.open(fight));
    });
    p.onQuick(() => attempt(app, async () => {
      const state = await session.request(13006, {}, 13006);
      (await quick.front()).open(p.maxDunId() || FIRST_STAGE, state);
    }));
    return p;
  }, w => w.show(false));

  return { page, battle, mvp, fail, reward };
}

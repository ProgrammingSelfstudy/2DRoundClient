// Dev conveniences, switched on by the page's ?key=value so that a page can be looked at without an account that has what it shows:
//   ?bagdemo=1     the backpack filled with made-up stacks        ?herodemo=1    60 made-up heroes in the hero page
//   ?mvpdemo=1     the win window with a made-up result           ?faildemo=1    the defeat window
//   ?rewarddemo=1  the reward window with a made-up quick battle  ?battledemo=1  the first battle's two models on the screen
//   ?skilldemo=10401_4   every active skill of that hero (bid_star) against a dummy; see skilldemo.ts
//   ?skillbtn=70501_5    a button per skill of that hero over the page, to cast them by hand
// (?lev= of the main city and ?allstars= of the hero filter are read where they apply.)
import { App, attempt } from "./app";
import type { campaignFeature } from "./campaign";
import { runSkillButtons, runSkillDemo } from "./skilldemo";
import { spineNode } from "./spine";

export function devtools(app: App, campaign: ReturnType<typeof campaignFeature>): void {
  const { query: q, store, windows } = app;
  const on = (key: string) => q.get(key) === "1";

  if (on("bagdemo")) {
    const ids = [1, 3, 10001, 99955, 10002, 10003, 20001, 30001, 40001, 50001, 60001, 70001, 80001, 90001, 11001, 12001, 13001, 14001, 15001, 16001, 17001, 18001, 19001];
    store.pin("bag", () => { store.items = ids.map((base_id, i) => ({ base_id, quantity: 1 + i * 7 })); });
  }
  if (on("herodemo")) {
    const bids = [10101, 10201, 10202, 10301, 10302, 10303, 10304, 10305, 10401, 10402, 10403, 10404, 10405, 10501, 10502, 10503, 10504, 10505, 10506, 10507];
    store.pin("heroes", () => { store.heroes = Array.from({ length: 60 }, (_, i) => ({ partner_id: i + 1, bid: bids[i % bids.length], lev: 1 + i, star: 1 + (i % 5), power: 1000 * i })); });
  }
  if (on("faildemo")) attempt(app, async () => (await campaign.fail.front()).open());
  // a made-up result (a level gained, six rewards)
  if (on("mvpdemo")) attempt(app, async () => (await campaign.mvp.front()).open({ result: 1, partner_hurt: 12345, partner_total_hurt: 20000, lev: 5, exp: 400, new_lev: 6, new_exp: 150, item_rewards: [1, 3, 10001, 10002, 10003, 20001].map((bid, i) => ({ bid, num: 100 * (i + 1) })) } as never));
  // a made-up quick battle that gains a level, to look at the bar and the item grid
  if (on("rewarddemo")) attempt(app, async () => (await campaign.reward.front()).open({ type: 2, time: 7200, old_lev: 5, new_lev: 6, old_exp: 400, new_exp: 150, vip_buff: 0, honor_buff: 0, items: [1, 3, 10001, 10002, 10003, 20001, 30001, 40001, 50001].map((bid, i) => ({ bid, num: 100 * (i + 1) })) } as never));
  // hero 10401 star 4 = H30009, enemy 101011 = H30012
  if (on("battledemo")) {
    for (const [model, x] of [["H30009", -170], ["H30012", 170]] as const) {
      spineNode(`spine/hero/${model}/stand2`, "stand2", windows.layer("popup")).then(sk => sk.node.setPosition(x, -60, 0), e => console.warn(`battledemo ${model}: ${(e as Error).message}`));
    }
  }
  const skillDemo = q.get("skilldemo");
  if (skillDemo) campaign.battle.front().then(b => runSkillDemo(b, skillDemo)).catch(e => console.warn(`skilldemo: ${(e as Error).message}`));
  const skillBtn = q.get("skillbtn");
  if (skillBtn) campaign.battle.front().then(b => runSkillButtons(b, skillBtn)).catch(e => console.warn(`skillbtn: ${(e as Error).message}`));
}

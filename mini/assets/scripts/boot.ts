// Boot: runs when the project scripts load. The scene holds a Canvas and a camera; the pages are built in code.
// Flow: ask the server for the release -> load the manifest -> show the login page -> log in with the shared network layer.
import { Canvas, Director, ResolutionPolicy, director, profiler, screen, view } from "cc";
import { loadRelease } from "./cdn";
import { buildLoginPage } from "./loginpage";
import { buildMainPage } from "./mainpage";
import { buildBackpackPage } from "./backpackpage";
import { buildHeroPage } from "./heropage";
import { buildHeroDetail } from "./herodetail";
import { buildFormPanel, type Formation } from "./formpanel";
import type { Hero } from "./herocell";
import { buildDramaPage } from "./dramapage";
import { buildQuickWindow } from "./quickwindow";
import { buildHookReward } from "./hookreward";
import { buildMvpWindow } from "./battlemvp";
import { spineNode } from "./spine";
import { buildBattleScene } from "./battlescene";
import { Feed, runFight } from "./battleflow";
import { buildCityScene } from "./citybg";
import { toast } from "./toast";
import { GameSocket } from "./shared/net";
import { Session } from "./shared/session";
import { enterGame, httpRegister, randomCredentials } from "./shared/login";
import { loadMainCity } from "./shared/city";

// The game is a 720x1280 portrait. A window wider than that (a desktop browser) shows the whole design centred with bars at the sides;
// a narrower, taller one (a phone) fills the width and shows a little more height.
function fitView() {
  const ws = screen.windowSize;
  const wider = ws.width / ws.height > 720 / 1280;
  view.setDesignResolutionSize(720, 1280, wider ? ResolutionPolicy.SHOW_ALL : ResolutionPolicy.FIXED_WIDTH);
  frameStyle(wider);
}

// On a wide window the canvas is clipped to the centred portrait column with rounded corners, the rest shows a dark page background;
// on a phone-shaped window there is nothing to clip. The column is as wide as the design at the window's height (100vh * 720/1280).
function frameStyle(wider: boolean) {
  const canvasEl = document.getElementById("GameCanvas");
  if (!canvasEl) return;
  document.body.style.backgroundColor = wider ? "#14141c" : "";
  canvasEl.style.clipPath = wider ? "inset(0 calc((100% - 100vh * 0.5625) / 2) round 28px)" : "none";
}

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, async () => {
  profiler.hideStats();
  fitView();
  const canvas = director.getScene()!.getComponentInChildren(Canvas)!.node;

  // dev conveniences, so a page can be checked without typing: ?acct=..&pass=..&autologin=1
  const q = new URLSearchParams(location.search);
  let account = q.get("acct") ?? "";
  try { account = account || localStorage.getItem("account") || ""; } catch { /* storage may be blocked */ }

  // the release comes first: the page draws its background and logo from the manifest
  let rel: { version: string; notice: string } | null = null;
  let relError = "";
  try { rel = await loadRelease(); } catch (e) { relError = `取不到资源版本：${(e as Error).message}`; }
  const page = await buildLoginPage(canvas, account, q.get("pass") ?? "");
  screen.on("window-resize", () => { fitView(); page.relayout(); });
  if (rel) {
    page.setFooter(`资源版本 ${rel.version}`);
    if (rel.notice) page.setStatus(rel.notice);
  } else {
    page.setStatus(relError, true);
  }

  const sock = new GameSocket();
  const session = new Session(sock);
  const url = `ws://${location.hostname}:8802/ws`;
  // `resume` is a login saved by an earlier visit: the account and the server's token, so a reload needs no password
  const run = async (resume?: { account: string; token: string }) => {
    const acct = resume?.account ?? page.account.string.trim();
    const pass = page.password.string;
    if (!resume && (!acct || !pass)) return page.setStatus("请输入账号和密码", true);
    page.setBusy(true);
    try {
      const entered = await enterGame(session, url, acct, pass, (name, state, detail) => {
        if (state === "fail") page.setStatus(resume ? "登录已过期，请重新输入密码" : `${name}：${detail ?? ""}`, true);
        else if (state === "doing") page.setStatus(resume ? "自动登录中…" : `${name}…`);
      }, resume?.token);
      try {
        localStorage.setItem("account", acct);
        // the token, never the password: a reload logs in with it again (see tryResume)
        localStorage.setItem("session", JSON.stringify({ account: acct, token: entered.token, at: Date.now() }));
      } catch { /* ignore */ }
      page.setStatus(`已进入游戏：${entered.name}，正在加载主城…`);
      const city = await loadMainCity(session, () => {});
      const r = city.role as Record<string, unknown>;
      page.setStatus(`${r.name}  Lv${r.lev}  战力 ${r.power}　英雄 ${city.partners.length}　任务 ${city.quests.length}`);
      const cityScene = await buildCityScene(canvas); // under every page
      screen.on("window-resize", cityScene.relayout);
      // no building opens a page yet: say which one was tapped
      cityScene.onBuilding(bd => toast(canvas, `${bd.name.replace("图标", "")}：暂未开放`));
      const bag = await buildBackpackPage(canvas);
      // dev convenience: ?bagdemo=1 fills the backpack with made-up stacks, to look at icons and paging without an account that owns items
      const demo = q.get("bagdemo") === "1" ? [1, 3, 10001, 99955, 10002, 10003, 20001, 30001, 40001, 50001, 60001, 70001, 80001, 90001, 11001, 12001, 13001, 14001, 15001, 16001, 17001, 18001, 19001].map((base_id, i) => ({ base_id, quantity: 1 + i * 7 })) : null;
      bag.setItems(demo ?? (city.items as unknown as { base_id: number; quantity: number }[]), city.equips as unknown as { base_id: number; quantity: number }[]);
      const heroes = await buildHeroPage(canvas);
      // dev convenience: ?herodemo=1 shows 60 made-up heroes, to look at the grid and scrolling
      const bids = [10101, 10201, 10202, 10301, 10302, 10303, 10304, 10305, 10401, 10402, 10403, 10404, 10405, 10501, 10502, 10503, 10504, 10505, 10506, 10507];
      const heroDemo = q.get("herodemo") === "1" ? Array.from({ length: 60 }, (_, i) => ({ partner_id: i + 1, bid: bids[i % bids.length], lev: 1 + i, star: 1 + (i % 5), power: 1000 * i })) : null;
      heroes.setHeroes((heroDemo ?? city.partners) as unknown as Parameters<typeof heroes.setHeroes>[0], Number(city.heroBag?.num ?? 0));
      // the list read at login goes stale (summons, grants): read it again when the hero page or the formation window opens
      const refreshHeroes = async () => {
        if (heroDemo) return;
        try {
          const r = await session.request(11025, {}, 11025);
          city.partners = (r.partners as typeof city.partners | undefined) || [];
          heroes.setHeroes(city.partners as unknown as Parameters<typeof heroes.setHeroes>[0], Number(r.num ?? 0));
        } catch (e) { console.warn("hero list:", (e as Error).message); }
      };
      const detail = await buildHeroDetail(canvas);
      // tapping a hero opens its info window at once with what the list has, then fills the attribute list from 11063
      heroes.onHero(async h => {
        detail.open(h, null);
        try { detail.setAttrs(h.partner_id, await session.request(11063, { partner_id: h.partner_id }, 11063)); } catch (e) { toast(canvas, (e as Error).message); }
      });
      const drama = await buildDramaPage(canvas);
      drama.setDrama(city.drama, Number((city.role as Record<string, unknown>).lev ?? 0));
      const battle = await buildBattleScene(canvas);
      const feed = new Feed(session, [20002, 20004, 13016]);
      battle.onTap(() => battle.show(false)); // no controls yet: a tap goes back to the stage page
      // the boss button opens the formation window (11211, kind 0 is the campaign's); its fight button saves the formation (11212) and sends 13003
      const go = async (a: "fight" | "next") => {
        try {
          session.last.delete(20027); // only a fight this click started counts
          session.last.delete(13001);
          const reply = a === "next" ? await session.request(13002, {}, 13002) : await session.request(13003, { is_auto: 0 }, 13003);
          await session.quiet(300, 3000);
          const opening = session.last.get(20027);
          if (a === "fight" && opening) {
            const result = await runFight(session, feed, battle, opening, 10008); // 10008: the first chapter's map (data_drama_world_info)
            const win = Number(result.result) === 1;
            if (!win) battle.banner("战斗失败", false);
            await session.quiet(300, 2000);
            const progress = session.last.get(13001);
            if (progress) drama.setDrama(progress, Number((city.role as Record<string, unknown>).lev ?? 0)); // the new stage after a win
            if (win) { await mvp.open(result); battle.show(false); } // the win window over the battle, then back to the stage page
            return;
          }
          toast(canvas, String(reply.msg ?? ""));
        } catch (e) { toast(canvas, (e as Error).message); }
      };
      const form = await buildFormPanel(canvas, text => toast(canvas, text));
      const heroList = () => city.partners as unknown as Hero[];
      const save = async (f: Formation): Promise<boolean> => {
        const pos_info = f.slots.map((h, i) => (h ? { pos: i + 1, id: h.partner_id } : null)).filter(Boolean);
        const reply = await session.request(11212, { type: 0, formation_type: f.formation_type, hallows_id: 0, pos_info }, 11212);
        if (Number(reply.code) !== 1) toast(canvas, String(reply.msg ?? "保存失败"));
        return Number(reply.code) === 1;
      };
      form.onSave(async f => { try { return await save(f); } catch (e) { toast(canvas, (e as Error).message); return false; } });
      form.onFight(async f => {
        try { if (!(await save(f))) return; } catch (e) { return toast(canvas, (e as Error).message); }
        form.close();
        await go("fight");
      });
      heroes.onEmbattle(async () => {
        try { await refreshHeroes(); form.open(await session.request(11211, { type: 0 }, 11211), heroList(), false); } catch (e) { toast(canvas, (e as Error).message); }
      });
      drama.onBoss(async a => {
        if (a === "level") return toast(canvas, "等级不足");
        if (a === "next") return go("next");
        try { await refreshHeroes(); form.open(await session.request(11211, { type: 0 }, 11211), heroList()); } catch (e) { toast(canvas, (e as Error).message); }
      });
      const main = await buildMainPage(canvas); // built after the pages so the top bar and the tabs stay on top of them
      // the quick battle window sits over everything, the way the original's dialogue does
      const quick = await buildQuickWindow(canvas);
      session.on(13006, m => quick.setQuick(m)); // after a quick battle the server pushes the new count
      const mvp = await buildMvpWindow(canvas); // 13016: the win window of a campaign fight
      const reward = await buildHookReward(canvas); // 13007: what a quick battle or a hook claim paid
      session.on(13007, m => { quick.close(); reward.open(m); });
      // dev convenience: ?rewarddemo=1 opens the reward window with a made-up quick battle that gains a level, to look at the bar and the item grid
      // dev convenience: ?mvpdemo=1 opens the win window with a made-up result (a level gained, six rewards)
      if (q.get("mvpdemo") === "1") void mvp.open({ result: 1, partner_hurt: 12345, partner_total_hurt: 20000, lev: 5, exp: 400, new_lev: 6, new_exp: 150, item_rewards: [1, 3, 10001, 10002, 10003, 20001].map((bid, i) => ({ bid, num: 100 * (i + 1) })) } as never);
      if (q.get("rewarddemo") === "1") reward.open({ type: 2, time: 7200, old_lev: 5, new_lev: 6, old_exp: 400, new_exp: 150, vip_buff: 0, honor_buff: 0, items: [1, 3, 10001, 10002, 10003, 20001, 30001, 40001, 50001].map((bid, i) => ({ bid, num: 100 * (i + 1) })) } as never);
      drama.onQuick(async () => {
        try { quick.open(drama.maxDunId() || 10010, await session.request(13006, {}, 13006)); } catch (e) { toast(canvas, (e as Error).message); }
      });
      quick.onQuick(async () => {
        try {
          const reply = await session.request(13004, {}, 13004);
          toast(canvas, String(reply.msg ?? ""));
        } catch (e) { toast(canvas, (e as Error).message); }
      });
      main.setCity(city);
      // tab 1 is the main city, 2 the heroes, 3 the backpack, 4 the stages; the other tabs have no page yet
      // 10923: the server tells one activity icon opening or closing while the player is in the city
      session.on(10923, m => main.icons.setOpen(Number(m.id), Number(m.status) !== 0));
      main.icons.onIcon(name => toast(canvas, `${name}：暂未开放`));
      main.onTab(t => { if (t === 2) void refreshHeroes(); detail.close(); form.close(); heroes.show(t === 2); bag.show(t === 3); drama.show(t === 4); });
      // dev convenience: ?battledemo=1 stands the first battle's two models (hero 10401 star 4 = H30009, enemy 101011 = H30012) on the screen
      if (q.get("battledemo") === "1") {
        for (const [model, x] of [["H30009", -170], ["H30012", 170]] as const) {
          spineNode(`spine/hero/${model}/stand2`, "stand2", canvas).then(sk => sk.node.setPosition(x, -60, 0), e => console.warn(`battledemo ${model}: ${(e as Error).message}`));
        }
      }
      page.hide(); // the login page gives way to the main city
    } catch (e) {
      console.warn(`login flow: ${(e as Error).stack ?? e}`);
      // the failing step is already on the page; a saved login the server refused is not tried again
      if (resume) try { localStorage.removeItem("session"); } catch { /* ignore */ }
    } finally {
      page.setBusy(false);
    }
  };
  page.onLogin(() => { void run(); });
  // 一键注册: make up an account and a password, register them, show them in the fields and log in
  page.onRegister(async () => {
    page.setBusy(true);
    try {
      const c = randomCredentials();
      page.setStatus("注册中…");
      await httpRegister(c.account, c.password);
      page.account.string = c.account;
      page.password.string = c.password;
      page.setNote(`已注册　账号 ${c.account}　密码 ${c.password}\n请记下，之后用它们登录`);
      page.setStatus("注册成功，登录中…");
    } catch (e) {
      page.setStatus(`注册失败：${(e as Error).message}`, true);
      page.setBusy(false);
      return;
    }
    page.setBusy(false);
    await run();
  });
  // a reload: log in again with the saved token (?fresh=1 skips it); the server's token lasts 24 hours by default
  if (!q.get("fresh") && !q.get("acct")) {
    try {
      const saved = JSON.parse(localStorage.getItem("session") ?? "null") as { account: string; token: string; at: number } | null;
      if (saved?.token && Date.now() - saved.at < 24 * 3600 * 1000) { page.account.string = saved.account; void run(saved); }
    } catch { /* storage blocked or corrupt: show the login page */ }
  }
  if (q.get("autologin") === "1") page.account.string && page.password.string && page.password.node.emit("editing-return");
});

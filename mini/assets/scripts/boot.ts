// Boot: runs when the project scripts load. The scene holds a Canvas and a camera; the pages are built in code.
// Flow: ask the server for the release -> load the manifest -> show the login page -> log in with the shared network layer.
import { Canvas, Director, ResolutionPolicy, director, profiler, screen, view } from "cc";
import { loadRelease } from "./cdn";
import { buildLoginPage } from "./loginpage";
import { buildMainPage } from "./mainpage";
import { buildBackpackPage } from "./backpackpage";
import { buildHeroPage } from "./heropage";
import { buildDramaPage } from "./dramapage";
import { spineNode } from "./spine";
import { buildBattleScene } from "./battlescene";
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
      bag.setItems(demo ?? (city.items as unknown as { base_id: number; quantity: number }[]));
      const heroes = await buildHeroPage(canvas);
      // dev convenience: ?herodemo=1 shows 60 made-up heroes, to look at the grid and scrolling
      const bids = [10101, 10201, 10202, 10301, 10302, 10303, 10304, 10305, 10401, 10402, 10403, 10404, 10405, 10501, 10502, 10503, 10504, 10505, 10506, 10507];
      const heroDemo = q.get("herodemo") === "1" ? Array.from({ length: 60 }, (_, i) => ({ partner_id: i + 1, bid: bids[i % bids.length], lev: 1 + i, star: 1 + (i % 5), power: 1000 * i })) : null;
      heroes.setHeroes((heroDemo ?? city.partners) as unknown as Parameters<typeof heroes.setHeroes>[0], Number(city.heroBag?.num ?? 0));
      const drama = await buildDramaPage(canvas);
      drama.setDrama(city.drama, Number((city.role as Record<string, unknown>).lev ?? 0));
      const battle = await buildBattleScene(canvas);
      battle.onTap(() => battle.show(false)); // no controls yet: a tap goes back to the stage page
      // the boss button: the original opens the formation panel first (not built), then sends 13003; here it sends 13003 with the saved formation
      drama.onBoss(async a => {
        if (a === "level") return toast(canvas, "等级不足");
        try {
          const reply = a === "next" ? await session.request(13002, {}, 13002) : await session.request(13003, { is_auto: 0 }, 13003);
          await session.quiet(300, 3000);
          const pushes = Array.from(session.last.keys()).filter(c => c >= 20000 && c < 20100).length;
          const opening = session.last.get(20027);
          if (opening && a === "fight") { await battle.start(opening, 10008); battle.show(true); } // 10008: the first chapter's map (data_drama_world_info)
          toast(canvas, `${String(reply.msg ?? "")}${pushes ? `（收到 ${pushes} 种战斗推送，只做了开场画面，点一下返回）` : ""}`);
        } catch (e) { toast(canvas, (e as Error).message); }
      });
      const main = await buildMainPage(canvas); // built after the pages so the top bar and the tabs stay on top of them
      main.setCity(city);
      // tab 1 is the main city, 2 the heroes, 3 the backpack, 4 the stages; the other tabs have no page yet
      // 10923: the server tells one activity icon opening or closing while the player is in the city
      session.on(10923, m => main.icons.setOpen(Number(m.id), Number(m.status) !== 0));
      main.icons.onIcon(name => toast(canvas, `${name}：暂未开放`));
      main.onTab(t => { heroes.show(t === 2); bag.show(t === 3); drama.show(t === 4); });
      // dev convenience: ?battledemo=1 stands the first battle's two models (hero 10401 star 4 = H30009, enemy 101011 = H30012) on the screen
      if (q.get("battledemo") === "1") {
        for (const [model, x] of [["H30009", -170], ["H30012", 170]] as const) {
          spineNode(`spine/hero/${model}/stand2`, "stand2", canvas).then(sk => sk.node.setPosition(x, -60, 0), e => console.warn(`battledemo ${model}: ${(e as Error).message}`));
        }
      }
      page.hide(); // the login page gives way to the main city
    } catch {
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

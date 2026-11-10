// Boot: runs when the project scripts load. The scene holds a Canvas and a camera; the pages are built in code.
// Flow: ask the server for the release -> load the manifest -> show the login page -> log in with the shared network layer -> enter the city
// (game.ts). What the game does after that is in the features (heroes.ts, campaign.ts, ...), not here.
import { Canvas, Director, ResolutionPolicy, director, profiler, screen, view } from "cc";
import type { App } from "./app";
import { loadRelease } from "./cdn";
import { enterCity } from "./game";
import { buildLoginPage } from "./loginpage";
import { Store } from "./store";
import { toast } from "./toast";
import { Windows } from "./windows";
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
  const store = new Store(session);
  let windows: Windows | null = null; // set while the city is being built
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
      store.load(city);
      page.setStatus(`${store.role.name}  Lv${store.role.lev}  战力 ${store.role.power}　英雄 ${city.partners.length}　任务 ${city.quests.length}`);
      windows = new Windows(canvas);
      const tips = windows.layer("tip");
      const app: App = { session, store, windows, query: q, toast: text => toast(tips, text) };
      await enterCity(app);
      windows = null; // the game stands: nothing to take down
      page.hide(); // the login page gives way to the main city
    } catch (e) {
      console.warn(`login flow: ${(e as Error).stack ?? e}`);
      // the failing step is already on the page; a saved login the server refused is not tried again
      if (resume) try { localStorage.removeItem("session"); } catch { /* ignore */ }
      windows?.destroy(); // a city that was only half built is taken off again, so the next try starts from nothing
      windows = null;
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

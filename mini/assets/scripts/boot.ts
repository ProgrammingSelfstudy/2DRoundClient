// Boot: runs when the project scripts load. The scene holds a Canvas and a camera; the pages are built in code.
// Flow: ask the server for the release -> load the manifest -> show the login page -> log in with the shared network layer -> enter the city
// (game.ts). What the game does after that is in the features (heroes.ts, campaign.ts, ...), not here.
import { Canvas, Director, Node, ResolutionPolicy, director, profiler, screen, view } from "cc";
import type { App } from "./app";
import { CLIENT_VERSION, loadRelease } from "./cdn";
import { mountFeedback, type FeedbackResult } from "./feedback";
import { enterCity } from "./game";
import { buildLoginPage } from "./loginpage";
import { H5_OPERATION_LOG_PREFIX, OperationLog } from "./operationlog";
import { Store } from "./store";
import { toast } from "./toast";
import { Windows } from "./windows";
import { buildBattleScene } from "./battlescene";
import { runSkillButtons, runSkillDemo } from "./skilldemo";
import { runSkillTune } from "./skilltunepanel";
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
  const log = new OperationLog(CLIENT_VERSION);
  log.record("appOpened");

  // dev conveniences, so a page can be checked without typing: ?acct=..&pass=..&autologin=1
  const q = new URLSearchParams(location.search);
  let account = q.get("acct") ?? "";
  try { account = account || localStorage.getItem("account") || ""; } catch { /* storage may be blocked */ }

  // the release comes first: the page draws its background and logo from the manifest
  let rel: { version: string; notice: string; wsUrl: string } | null = null;
  let relError = "";
  try {
    rel = await loadRelease();
    log.setRelease(rel.version);
  } catch (e) {
    log.record("releaseFailed");
    relError = `取不到资源版本：${(e as Error).message}`;
  }
  // the skill preview pages (?skilltune=, ?skillbtn=, ?skilldemo=) need no account: they show a hero against a dummy from the release tables alone,
  // so they open straight from the hero picker (mini/heroes.html) without the login page
  const previewSpec = q.get("skilltune") || q.get("skillbtn") || q.get("skilldemo");
  if (previewSpec) {
    screen.on("window-resize", fitView);
    try {
      const scene = await buildBattleScene(new Windows(canvas).layer("popup"), "preview");
      try {
        if (q.get("skilltune")) await runSkillTune(scene, previewSpec);
        else if (q.get("skillbtn")) await runSkillButtons(scene, previewSpec);
        else await runSkillDemo(scene, previewSpec);
      } catch (e) { scene.stop(); throw e; }
    } catch (e) {
      console.warn(`skill preview: ${(e as Error).stack ?? e}`);
    }
    return;
  }
  const page = await buildLoginPage(canvas, account, q.get("pass") ?? "");
  screen.on("window-resize", () => { fitView(); page.relayout(); });
  if (rel) {
    page.setFooter(`资源版本 ${rel.version}`);
    if (rel.notice) page.setStatus(rel.notice);
  } else {
    page.setStatus(relError, true);
  }

  const sock = new GameSocket();
  sock.onState = state => {
    if (state === "open") log.record("connected");
    else if (state === "error") log.record("connectionError");
    else if (state.startsWith("closed")) log.record("disconnected");
  };
  const session = new Session(sock);
  const store = new Store(session);
  let windows: Windows | null = null; // set while the city is being built
  let disposeFeedback: (() => void) | undefined;
  canvas.once(Node.EventType.NODE_DESTROYED, () => disposeFeedback?.());
  // The server names the gateway (an https page must use wss, and the gateway is on another host than the page there); without a
  // name it is the page's own host on 8802, which is the LAN set-up.
  const url = rel?.wsUrl || `ws://${location.hostname}:8802/ws`;
  const submitFeedback = async (title: string, content: string, operationLog: string): Promise<FeedbackResult> => {
    try {
      const reply = await session.request(10810, {
        issue_type: 3, title, content, phone: "", email: "", phone_info: H5_OPERATION_LOG_PREFIX + operationLog, id: 0,
      }, 10810);
      if (Number(reply.code) !== 1) return { status: "rejected", message: String(reply.msg || "提交失败，请稍后重试。") };
      const id = Number(reply.id);
      if (id > 0) return { status: "sent", id };
    } catch (e) {
      if (e instanceof Error && e.message === "not connected") {
        return { status: "rejected", message: "游戏连接已断开，草稿已保留。" };
      }
    }
    return { status: "unknown", message: "未收到工单确认，草稿已保留。请先核对工单，避免重复提交。" };
  };
  // `resume` is a login saved by an earlier visit: the account and the server's token, so a reload needs no password
  const run = async (resume?: { account: string; token: string }) => {
    const acct = resume?.account ?? page.account.string.trim();
    const pass = page.password.string;
    if (!resume && (!acct || !pass)) return page.setStatus("请输入账号和密码", true);
    log.record(resume ? "resume" : "login");
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
      const app: App = { session, store, windows, log, query: q, toast: text => toast(tips, text) };
      await enterCity(app);
      log.record("city");
      disposeFeedback?.();
      disposeFeedback = mountFeedback({
        snapshot: () => log.snapshot(),
        submit: submitFeedback,
        draftKey: `2dround.feedback.${entered.srv_id}.${entered.rid}`,
      });
      windows = null; // the game stands: nothing to take down
      page.hide(); // the login page gives way to the main city
    } catch (e) {
      log.record("loginFailed");
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
    log.record("register");
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
      log.record("registerFailed");
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

// Boot: runs when the project scripts load. The scene holds a Canvas and a camera; the pages are built in code.
// Flow: ask the server for the release -> load the manifest -> show the login page -> log in with the shared network layer.
import { Canvas, Director, ResolutionPolicy, director, profiler, view } from "cc";
import { loadRelease } from "./cdn";
import { buildLoginPage } from "./loginpage";
import { GameSocket } from "./shared/net";
import { Session } from "./shared/session";
import { enterGame } from "./shared/login";
import { loadMainCity } from "./shared/city";

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, async () => {
  profiler.hideStats();
  view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
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
  if (rel) {
    page.setFooter(`资源版本 ${rel.version}`);
    if (rel.notice) page.setStatus(rel.notice);
  } else {
    page.setStatus(relError, true);
  }

  const sock = new GameSocket();
  const session = new Session(sock);
  const url = `ws://${location.hostname}:8802/ws`;
  page.onLogin(async () => {
    const acct = page.account.string.trim();
    const pass = page.password.string;
    if (!acct || !pass) return page.setStatus("请输入账号和密码", true);
    page.setBusy(true);
    try {
      const entered = await enterGame(session, url, acct, pass, (name, state, detail) => {
        if (state === "fail") page.setStatus(`${name}：${detail ?? ""}`, true);
        else if (state === "doing") page.setStatus(`${name}…`);
      });
      try { localStorage.setItem("account", acct); } catch { /* ignore */ }
      page.setStatus(`已进入游戏：${entered.name}，正在加载主城…`);
      const city = await loadMainCity(session, () => {});
      const r = city.role as Record<string, unknown>;
      page.setStatus(`${r.name}  Lv${r.lev}  战力 ${r.power}　英雄 ${city.partners.length}　任务 ${city.quests.length}`);
    } catch {
      // the failing step is already on the page
    } finally {
      page.setBusy(false);
    }
  });
  if (q.get("autologin") === "1") page.account.string && page.password.string && page.password.node.emit("editing-return");
});

import { GameSocket, type Logged } from "./net.ts";
import { recv, send } from "./proto/schema.ts";
import { Session } from "./session.ts";
import { enterGame } from "./login.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sock = new GameSocket();
const session = new Session(sock);
// the gateway's WebSocket is on the same host as this page, so the page works from localhost and from a LAN address alike
const url = new URLSearchParams(location.search).get("ws") ?? `ws://${location.hostname}:8802/ws`;

$("url").textContent = url;
$("schema").textContent = `${Object.keys(send).length} 个请求，${Object.keys(recv).length} 个响应`;
sock.onState = s => {
  $("state").textContent = s.replace("closed-ok", "已断开");
  $("state").dataset.s = s.split(" ")[0];
  ($("beat") as HTMLButtonElement).disabled = s !== "open";
  // 1006 is what a browser reports for any failed handshake; the gateway answers 403 to a page whose origin is not in gateway.ws_origins
  $("hint").textContent = s.startsWith("closed (1006)")
    ? "连接没有建立：检查网关是否在运行，以及本页地址是否在网关配置 gateway.ws_origins 里（浏览器会带 Origin，不在名单里会被 403 拒绝）。"
    : "";
};
($("beat") as HTMLButtonElement).disabled = true;
sock.onLog = (e: Logged) => {
  const tr = document.createElement("tr");
  const time = new Date(e.t).toLocaleTimeString();
  const body = e.error ? `⚠ ${e.error}` : JSON.stringify(e.msg, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  tr.innerHTML = `<td>${time}</td><td class="${e.dir}">${e.dir === "c2s" ? "发送" : "收到"}</td><td>${e.cmd}</td><td>${e.size}</td><td class="body"></td>`;
  (tr.lastElementChild as HTMLElement).textContent = body.length > 300 ? body.slice(0, 300) + "…" : body;
  $("log").prepend(tr);
};
const logError = (cmd: number, e: unknown) => sock.onLog({ t: Date.now(), dir: "c2s", cmd, size: 0, msg: null, error: (e as Error).message });
$("connect").onclick = () => session.open(url).catch(e => logError(0, e));
$("close").onclick = () => {
  stopHeartbeat();
  sock.close();
};
$("beat").onclick = () => {
  try {
    session.send(1169);
  } catch (e) {
    // an inline message, never alert(): a modal dialog freezes the page and any browser automation attached to it
    logError(1169, e);
  }
};

// login: the same sequence as the real client; each step shows up in the list as it finishes
let hb: ReturnType<typeof setInterval> | undefined;
const stopHeartbeat = () => { clearInterval(hb); hb = undefined; };
$("login").onclick = async () => {
  const btn = $("login") as HTMLButtonElement;
  const account = ($("acct") as HTMLInputElement).value.trim();
  const password = ($("pass") as HTMLInputElement).value;
  if (!account || !password) { $("loginSteps").innerHTML = "<li class=fail><span class=dot></span><span>请填写账号和密码</span></li>"; return; }
  btn.disabled = true;
  stopHeartbeat();
  $("role").textContent = "";
  const rows = new Map<string, HTMLElement>();
  $("loginSteps").innerHTML = "";
  try {
    const entered = await enterGame(session, url, account, password, (name, state, detail) => {
      let li = rows.get(name);
      if (!li) { li = document.createElement("li"); rows.set(name, li); $("loginSteps").append(li); }
      li.className = state === "doing" ? "doing" : state === "done" ? "done" : "fail";
      li.innerHTML = "<span class=dot></span><span></span>";
      (li.children[1] as HTMLElement).textContent = detail ? `${name}：${detail}` : name;
    });
    $("role").textContent = `已进入游戏：${entered.name}（rid ${entered.rid}，${entered.srv_id}）${entered.created ? "，刚创建的新角色" : ""}`;
    hb = setInterval(() => { try { session.send(1169); } catch { stopHeartbeat(); } }, 30000);
  } catch {
    // the failing step is already shown in red
  } finally {
    btn.disabled = false;
  }
};

// development progress: web/public/progress.json is edited as the work moves on
async function progress() {
  try {
    const p: { updated: string; steps: { name: string; state: string; note?: string }[] } = await (await fetch(`progress.json?${Date.now()}`)).json();
    $("updated").textContent = p.updated;
    $("steps").innerHTML = p.steps
      .map(s => `<li class="${s.state}"><span class="dot"></span><span>${s.name}${s.note ? `<small>${s.note}</small>` : ""}</span><em>${{ done: "完成", doing: "进行中", todo: "待做" }[s.state] ?? s.state}</em></li>`)
      .join("");
  } catch {
    $("updated").textContent = "读不到 progress.json";
  }
}
void progress();
setInterval(progress, 5000);

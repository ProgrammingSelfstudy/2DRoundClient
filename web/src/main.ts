import { GameSocket, type Logged } from "./net.ts";
import { recv, send } from "./proto/schema.ts";
import { Session } from "./session.ts";
import { enterGame } from "./login.ts";
import { loadMainCity, type City } from "./city.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sock = new GameSocket();
const session = new Session(sock);
// the gateway's WebSocket is on the same host as this page, so the page works from localhost and from a LAN address alike
const url = new URLSearchParams(location.search).get("ws") ?? `ws://${location.hostname}:8802/ws`;

$("url").textContent = url;
($("uilink") as HTMLAnchorElement).href = `http://${location.hostname}:8767/`;
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
    const onStep = (name: string, state: "doing" | "done" | "fail", detail?: string) => {
      let li = rows.get(name);
      if (!li) { li = document.createElement("li"); rows.set(name, li); $("loginSteps").append(li); }
      li.className = state === "doing" ? "doing" : state === "done" ? "done" : "fail";
      li.innerHTML = "<span class=dot></span><span></span>";
      (li.children[1] as HTMLElement).textContent = detail ? `${name}：${detail}` : name;
    };
    const entered = await enterGame(session, url, account, password, onStep);
    $("role").textContent = `已进入游戏：${entered.name}（rid ${entered.rid}，${entered.srv_id}）${entered.created ? "，刚创建的新角色" : ""}`;
    hb = setInterval(() => { try { session.send(1169); } catch { stopHeartbeat(); } }, 30000);
    renderCity(await loadMainCity(session, onStep));
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

// the main-city panel: raw field names from the protocol table, because what each one means is still to be matched against the client's Lua
function renderCity(c: City) {
  const esc = (v: unknown) => String(v).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string);
  const kv = (m: Record<string, unknown> | undefined, keys?: string[]) =>
    Object.entries(m ?? {}).filter(([k, v]) => (keys ? keys.includes(k) : typeof v !== "object")).map(([k, v]) => `<span class="kv"><i>${esc(k)}</i>${esc(v)}</span>`).join("");
  const role = c.role as Record<string, unknown> | undefined;
  $("city").innerHTML =
    `<h3>${esc(role?.name ?? "")}　Lv${esc(role?.lev ?? "")}　战力 ${esc(role?.power ?? 0)}</h3><div class="kvs">${kv(role, ["rid", "srv_id", "sex", "career", "face_id", "vip_lev", "reg_time", "exp_max"])}</div>` +
    `<h3>资产（10302）</h3><div class="kvs">${kv(c.assets as Record<string, unknown> | undefined)}</div>` +
    `<h3>主线进度（13000）</h3><div class="kvs">${kv(c.drama as Record<string, unknown> | undefined)}</div>` +
    `<h3>英雄（11025）：${c.partners.length}</h3><table><thead><tr><th>编号</th><th>模型</th><th>等级</th><th>星级</th><th>战力</th></tr></thead><tbody>${c.partners.map(p => `<tr><td>${esc(p.partner_id)}</td><td>${esc(p.bid)}</td><td>${esc(p.lev)}</td><td>${esc(p.star)}</td><td>${esc(p.power)}</td></tr>`).join("")}</tbody></table>` +
    `<h3>任务（10403）：${c.quests.length}</h3>` +
    `<h3>收到的回复（${c.frames.length} 种）</h3><div class="kvs">${c.frames.map(f => `<span class="kv"><i>${f.cmd}</i>${f.fields} 字段</span>`).join("")}</div>`;
}

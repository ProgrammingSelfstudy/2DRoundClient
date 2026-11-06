// The login sequence of the real client: HTTP (account -> token, server list), then on the socket 1164 (role list), 10191 (create a
// role when there is none) and 10192 (enter). Every step reports to `step` so a page can show where it stands.
import type { Msg } from "./proto/codec.ts";
import type { Session } from "./session.ts";

export type Step = (name: string, state: "doing" | "done" | "fail", detail?: string) => void;
export interface Server { srv_id: string; name: string; ip: string; port: number; is_maintain: boolean; }
export interface Entered { rid: number; name: string; srv_id: string; created: boolean; }

const PLATFORM = "symlf";
let HTTP_BASE = "/loginapi"; // the dev server proxies this to the login HTTP service, so the browser stays on one origin
export const setHttpBase = (base: string) => { HTTP_BASE = base; }; // for tests outside a browser, which have no proxy

// the login service answers in Lua-table text: {code=1, msg="..."}
const luaStr = (text: string, key: string) => new RegExp(`${key}="((?:[^"\\\\]|\\\\.)*)"`).exec(text)?.[1];
const luaNum = (text: string, key: string) => {
  const m = new RegExp(`${key}=(-?\\d+)`).exec(text);
  return m ? Number(m[1]) : undefined;
};
const LOGIN_ERRORS: Record<string, string> = { "206": "账号不存在", "207": "密码错误", "208": "账号状态异常，请联系客服" };

export async function httpLogin(account: string, password: string): Promise<string> {
  const q = new URLSearchParams({ username: account, password });
  const text = await (await fetch(`${HTTP_BASE}/index.php/userlogin/userLogins2?${q}`)).text();
  if (luaNum(text, "code") === 1) {
    const token = luaStr(text, "msg");
    if (token) return token;
  }
  const msg = luaStr(text, "msg") ?? "";
  throw new Error(LOGIN_ERRORS[msg] ?? `登录服务返回：${text.slice(0, 100)}`);
}

const REG_ERRORS: Record<string, string> = { "200": "账号已存在", "203": "账号只能用 6 到 12 位字母或数字", "204": "密码要 6 到 16 位" };

// the platform registration of the original client: "205" means registered
export async function httpRegister(account: string, password: string): Promise<void> {
  const q = new URLSearchParams({ username: account, password });
  const text = await (await fetch(`${HTTP_BASE}/index.php/userlogin/userRegs?${q}`)).text();
  const code = luaStr(text, "msg") ?? "";
  if (code !== "205") throw new Error(REG_ERRORS[code] ?? `注册服务返回：${text.slice(0, 100)}`);
}

// "一键注册": the client makes up an account and a password itself and shows them to the player
export function randomCredentials(): { account: string; password: string } {
  const pick = (n: number) => {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < n; i++) out += chars[bytes[i] % chars.length];
    return out;
  };
  return { account: "u" + pick(8), password: pick(8) };
}

export async function serverList(account: string): Promise<Server[]> {
  const q = new URLSearchParams({ account, platform: PLATFORM, channel: PLATFORM, srv: "" });
  const text = await (await fetch(`${HTTP_BASE}/api/serverlist?${q}`)).text();
  const list = text.slice(text.indexOf("server_list="));
  const out: Server[] = [];
  for (const m of list.matchAll(/\{srv_id="[^}]*\}/g)) {
    const e = m[0];
    out.push({ srv_id: luaStr(e, "srv_id") ?? "", name: luaStr(e, "name") ?? "", ip: luaStr(e, "ip") ?? "", port: luaNum(e, "port") ?? 0, is_maintain: /is_maintain=true/.test(e) });
  }
  if (out.length === 0) throw new Error("服务器列表为空");
  return out;
}

function deviceId(): string {
  try {
    let id = localStorage.getItem("device_id");
    if (!id) localStorage.setItem("device_id", (id = "web-" + Math.random().toString(36).slice(2, 12)));
    return id;
  } catch {
    return "web-anonymous";
  }
}

function loginArgs(account: string, token: string, srvId: string): Msg[] {
  const kv: [string, string][] = [
    ["account", account], ["timestamp", String(Math.floor(Date.now() / 1000))], ["enter_srv_id", srvId], ["platform", PLATFORM],
    ["device_id", deviceId()], ["device_type", "web"], ["token", token], ["channel", PLATFORM], ["os", "web"], ["now_ver", "v8"],
    ["package_name", "web.client"], ["package_version", "0.1"]
  ];
  return kv.map(([key, val]) => ({ key, val }));
}

export async function enterGame(session: Session, wsUrl: string, account: string, password: string, step: Step): Promise<Entered> {
  const run = async <T>(name: string, f: () => Promise<{ value: T; detail?: string }>): Promise<T> => {
    step(name, "doing");
    try {
      const { value, detail } = await f();
      step(name, "done", detail);
      return value;
    } catch (e) {
      step(name, "fail", (e as Error).message);
      throw e;
    }
  };

  const token = await run("账号登录（HTTP）", async () => ({ value: await httpLogin(account, password), detail: "拿到 token" }));
  const servers = await run("取服务器列表（HTTP）", async () => {
    const list = await serverList(account);
    return { value: list, detail: list.map(s => `${s.name}（${s.srv_id}）`).join("、") };
  });
  const srv = servers.find(s => !s.is_maintain) ?? servers[0];
  await run("连接网关（WebSocket）", async () => ({ value: await session.open(wsUrl), detail: wsUrl }));

  const roles = await run("角色列表（1164）", async () => {
    const r = await session.request(1164, { args: loginArgs(account, token, srv.srv_id) }, 1164);
    if (r.code !== 1) throw new Error(String(r.msg || `失败，code=${r.code}`));
    const list = r.roles as Msg[];
    return { value: list, detail: list.length ? list.map(x => `${x.name}（rid ${x.rid}，Lv${x.lev}）`).join("、") : "该账号在这个服还没有角色" };
  });

  let role = roles[0] as Msg | undefined;
  let created = false;
  if (!role) {
    role = await run("创建角色（10191）", async () => {
      const r = await session.request(10191, { sex: 1, name: "", career: 1, playform: PLATFORM }, 10191);
      if (r.code !== 1) throw new Error(String(r.msg || `失败，code=${r.code}`));
      created = true;
      return { value: { rid: r.rid, name: r.name, srv_id: r.srv_id } as Msg, detail: `${r.name}（rid ${r.rid}）` };
    });
  }
  await run("进入游戏（10192）", async () => {
    const r = await session.request(10192, { rid: role!.rid, srv_id: srv.srv_id }, 10192);
    if (r.code !== 1) throw new Error(String(r.msg || `失败，code=${r.code}`));
    return { value: r, detail: `服务器时间 ${new Date(Number(r.timestamp) * 1000).toLocaleString()}` };
  });
  return { rid: Number(role.rid), name: String(role.name), srv_id: srv.srv_id, created };
}

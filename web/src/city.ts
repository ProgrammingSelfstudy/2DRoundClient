// Loading the main city: right after 10192 the real client asks for its data with 10300 and then a fixed run of requests
// (testdata/captures/original-2026-10-26/login-main-city.jsonl). The server answers each, plus a few pushes of its own. Everything
// is kept by command in Session.last; this module only asks in the real order and then reads the answers out.
import type { Msg } from "./proto/codec.ts";
import type { Session } from "./session.ts";
import type { Step } from "./login.ts";

// [command, payload]; same order and payloads as the capture, up to the hero detail request 11026 (which names specific heroes)
export const MAIN_CITY_REQUESTS: ReadonlyArray<readonly [number, Msg?]> = [
  [10300], [31103], [31108], [31109], [31120], [31116], [23200], [27902], [10925, { id: 615 }], [10925, { id: 616 }], [16601], [21100],
  [13300], [10330], [10907], [10303], [14100], [10922], [10924], [10500], [24100], [24120], [20063], [10501], [10502],
  [16603, { bid: 991008 }], [16602], [13311], [10503], [11025], [20600], [20601], [20604], [20634], [10906], [10380], [24905], [24900]
];

export interface City {
  role: Msg | undefined;      // 10301
  assets: Msg | undefined;    // 10302
  drama: Msg | undefined;     // 13000, main-line progress
  partners: Msg[];            // 11025
  quests: Msg[];              // 10403
  items: Msg[];               // 10500, the backpack's first tab
  frames: { cmd: number; fields: number }[]; // every command that answered
}

export async function loadMainCity(session: Session, step: Step): Promise<City> {
  const name = `拉取主城数据（10300 起共 ${MAIN_CITY_REQUESTS.length} 个请求）`;
  step(name, "doing");
  try {
    for (const [cmd, msg] of MAIN_CITY_REQUESTS) {
      session.send(cmd, msg ?? {});
      await new Promise(r => setTimeout(r, 20)); // the real client sends them back to back; a gap keeps the log readable
    }
    await session.quiet();
    const city = readCity(session.last);
    if (!city.role) throw new Error("服务器没有推送角色信息 10301");
    step(name, "done", `收到 ${city.frames.length} 种回复；英雄 ${city.partners.length}，任务 ${city.quests.length}`);
    return city;
  } catch (e) {
    console.error(`${name}: ${(e as Error).stack ?? e}`);
    step(name, "fail", (e as Error).message);
    throw e;
  }
}

export function readCity(last: ReadonlyMap<number, Msg>): City {
  return {
    role: last.get(10301),
    assets: last.get(10302),
    drama: last.get(13000),
    partners: (last.get(11025)?.partners as Msg[] | undefined) ?? [],
    quests: (last.get(10403)?.quest_list as Msg[] | undefined) ?? [],
    items: (last.get(10500)?.item_list as Msg[] | undefined) ?? [],
    // Array.from, not [...last.entries()]: Creator down-levels spread of an iterator into something that yields undefined
    frames: Array.from(last, ([cmd, m]) => ({ cmd, fields: Object.keys(m).length })).sort((a, b) => a.cmd - b.cmd)
  };
}

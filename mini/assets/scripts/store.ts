// What the client knows about the player, kept in one place and kept up to date: the store listens to the server's frames itself (the answer to
// a request and a push are the same frame), turns them into plain typed values and tells whoever watches a topic that it changed. A page
// reads the store and watches its topic; it does not keep its own copy and nobody has to tell it to refresh.
import type { Hero } from "./herocell";
import type { City } from "./shared/city";
import type { Msg } from "./shared/proto/codec";
import type { Session } from "./shared/session";

export interface Role { name: string; lev: number; exp: number; expMax: number; power: number; vipLev: number; faceId: number }
export interface Assets { coin: number; gold: number; heroExp: number }
export interface Slot { base_id: number; quantity: number }

// heroes also: 11002 (one hero changed)   role: 10301 (and the level, exp and power the server sends apart: 10302, 10306)   assets: 10302   heroes: 11025
// bag: 10500 (items), 10501 (equipment)   drama: 13000, 13001   icons: 10922, 10924, 10923
export type Topic = "role" | "assets" | "heroes" | "bag" | "drama" | "icons";

const num = (v: unknown) => Number(v ?? 0);

export class Store {
  role: Role = { name: "", lev: 0, exp: 0, expMax: 0, power: 0, vipLev: 0, faceId: 0 };
  assets: Assets = { coin: 0, gold: 0, heroExp: 0 };
  heroes: Hero[] = [];
  heroCap = 0; // the hero bag's capacity
  items: Slot[] = [];
  equips: Slot[] = [];
  drama: Msg | undefined; // the main-line progress as the server sends it
  icons: number[] = []; // ids of the activity icons the server says are open

  private watchers = new Map<Topic, Array<() => void>>();
  private pinned: Topic[] = [];
  private session: Session;

  constructor(session: Session) {
    this.session = session;
    session.on(10301, m => this.set("role", () => this.readRole(m)));
    session.on(10302, m => { this.set("assets", () => this.readAssets(m)); this.set("role", () => { this.role = { ...this.role, lev: num(m.lev), exp: num(m.exp) }; }); });
    session.on(10306, m => this.set("role", () => { this.role = { ...this.role, power: num(m.power) }; }));
    session.on(11025, m => this.set("heroes", () => this.readHeroes(m)));
    session.on(11002, m => this.set("heroes", () => { // one hero changed (level, break): replace it in the list
      const h = { partner_id: num(m.partner_id), bid: num(m.bid), lev: num(m.lev), star: num(m.star), power: num(m.power) };
      const i = this.heroes.findIndex(x => x.partner_id === h.partner_id);
      if (i >= 0) this.heroes[i] = h; else this.heroes.push(h);
    }));
    session.on(10500, m => this.set("bag", () => { this.items = slots(m); }));
    session.on(10501, m => this.set("bag", () => { this.equips = slots(m); }));
    session.on(13000, m => this.set("drama", () => { this.drama = m; }));
    session.on(13001, m => this.set("drama", () => { this.drama = { ...(this.drama || {}), ...m }; })); // the new stage after a win: the fields 13000 has too
    session.on(10922, () => this.set("icons", () => this.readIcons()));
    session.on(10924, () => this.set("icons", () => this.readIcons()));
    session.on(10923, m => this.set("icons", () => {
      const id = num(m.id);
      this.icons = this.icons.filter(i => i !== id);
      if (num(m.status) !== 0) this.icons.push(id);
    }));
  }

  // everything the login read (loadMainCity); the frames that came before the store listened are in it
  load(city: City): void {
    const last = this.session.last;
    const role = last.get(10301), assets = last.get(10302), power = last.get(10306), heroes = last.get(11025);
    if (role) this.readRole(role);
    if (assets) { this.readAssets(assets); this.role = { ...this.role, lev: num(assets.lev) || this.role.lev, exp: num(assets.exp) }; }
    if (power) this.role = { ...this.role, power: num(power.power) };
    if (heroes) this.readHeroes(heroes);
    this.items = city.items.map(slot);
    this.equips = city.equips.map(slot);
    this.drama = city.drama;
    this.icons = city.icons.slice();
  }

  // call `f` whenever the topic changes; the function it returns stops the calls
  watch(topic: Topic, f: () => void): () => void {
    const list = this.watchers.get(topic) || [];
    list.push(f);
    this.watchers.set(topic, list);
    return () => { const i = list.indexOf(f); if (i >= 0) list.splice(i, 1); };
  }

  // the same, and once right away: what a page does to draw itself and then follow the changes
  follow(topic: Topic, f: () => void): () => void {
    f();
    return this.watch(topic, f);
  }

  // dev pages put made-up values in a topic; the server's frames then leave it alone
  pin(topic: Topic, change: () => void): void {
    change();
    this.pinned.push(topic);
    this.tell(topic);
  }

  // the hero list read at login goes stale (summons, grants): read it again; the answer comes in through the 11025 listener
  async refreshHeroes(): Promise<void> {
    if (this.pinned.indexOf("heroes") >= 0) return;
    await this.session.request(11025, {}, 11025);
  }

  private set(topic: Topic, change: () => void) {
    if (this.pinned.indexOf(topic) >= 0) return;
    change();
    this.tell(topic);
  }

  private tell(topic: Topic) {
    const list = this.watchers.get(topic);
    if (!list) return;
    for (const f of list.slice()) {
      try { f(); } catch (e) { console.warn(`store ${topic}: ${(e as Error).stack || e}`); } // one page's fault must not stop the others
    }
  }

  private readRole(m: Msg) {
    // 10301 has no exp: it stays what 10302 said
    this.role = { ...this.role, name: String(m.name ?? ""), lev: num(m.lev), expMax: num(m.exp_max), power: num(m.power), vipLev: num(m.vip_lev), faceId: num(m.face_id) };
  }

  private readAssets(m: Msg) {
    this.assets = { coin: num(m.coin), gold: num(m.gold), heroExp: num(m.hero_exp) };
  }

  private readHeroes(m: Msg) {
    const list = (m.partners as Msg[] | undefined) || [];
    this.heroes = list.map(p => ({ partner_id: num(p.partner_id), bid: num(p.bid), lev: num(p.lev), star: num(p.star), power: num(p.power) }));
    this.heroCap = num(m.num);
  }

  // 10922 (asked at login) and 10924 both list {id, status}; status 0 is "not open". The same id in both is one icon.
  private readIcons() {
    const ids: number[] = [];
    for (const cmd of [10922, 10924]) {
      const list = this.session.last.get(cmd)?.act_list as Msg[] | undefined;
      if (list) for (const a of list) if (num(a.status) !== 0 && ids.indexOf(num(a.id)) < 0) ids.push(num(a.id));
    }
    this.icons = ids;
  }
}

const slot = (m: Msg): Slot => ({ base_id: num(m.base_id), quantity: num(m.quantity) });
const slots = (m: Msg): Slot[] => ((m.item_list as Msg[] | undefined) || []).map(slot);

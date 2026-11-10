// Which heroes this client lists. The H5 client lists only the heroes whose initial star is MIN_HERO_STAR or more (the 5-star ones); the lower
// ones stay in every table, in the server and in the players' records, and this client just does not show them on the hero page or in the
// formation window's list. ?allstars=1 lists every hero again (to compare, or to look at the low-star heroes' models).
import type { PartnerTable } from "./herocell";

export const MIN_HERO_STAR = 5;

const showAll = (() => {
  try { return new URLSearchParams(location.search).get("allstars") === "1"; } catch { return false; }
})();

// partners.json's base row is [name, camp, initial star]; a bid the table does not know is listed (nothing to judge it by)
export function listed(table: PartnerTable, bid: number): boolean {
  if (showAll) return true;
  const row = table.base[String(bid)];
  return !row || row[2] >= MIN_HERO_STAR;
}

// the heroes of the hero page in its order (highest star, then power, then id), for what steps through them (the info window's arrows)
export function listedHeroes<T extends { bid: number; star: number; power: number; partner_id: number }>(table: PartnerTable, heroes: T[]): T[] {
  return heroes.filter(h => listed(table, h.bid)).sort((a, b) => b.star - a.star || b.power - a.power || a.partner_id - b.partner_id);
}

// Dev convenience: ?skilldemo=10401_4 (a hero's bid and star) plays every active skill of that hero in turn on the battle scene, against a standing
// dummy (the first stage's pirate, H30012), with the skill's name, number and animation over the field. Several can be given, ?skilldemo=10401_4,10101_1.
// The preview scene plays actions and effects without combat stats. Progress is kept in window.__skilldemo for scripted checks.
import { loadJson } from "./cdn";
import { chapterMap } from "./design";
import { PREVIEW_ACTOR, attackOf, previewCast, previewOpening } from "./skillplan";
import type { Fx } from "./skillplan";
import type { BattleScene } from "./battlescene";

interface HeroSkills { h: { [heroStar: string]: [string, number[]] }; k: { [skill: string]: [string, number[]] }; a?: { [skill: string]: [string, number[]] } } // a: every skill row with effects
export interface DemoStep { hero: string; model: string; skill: number; name: string; anim: string; effects: number; ms: number }
export interface DemoHero { hero: string; model: string; disc: boolean; skills: number }

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function startPreview(scene: BattleScene, hero: string, fx: Fx, effects: number[][]): Promise<void> {
  const [bid, star] = hero.split("_").map(Number);
  await scene.start(previewOpening(fx, bid, star, hero, effects), chapterMap(1));
  scene.show(true);
}

export async function runSkillDemo(scene: BattleScene, spec: string): Promise<void> {
  const [fx, table] = await Promise.all([loadJson<Fx>("tables/skill_fx.json"), loadJson<HeroSkills>("tables/hero_skills.json")]);
  const steps: DemoStep[] = [], heroes: DemoHero[] = [], warns: string[] = [];
  (window as unknown as { __skilldemo: unknown }).__skilldemo = { done: false, steps, heroes, warns };
  const warn = console.warn; // what the scene warns while a model loads (a file the release lacks) belongs to the hero on show
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); warn.apply(console, a); };
  try {
    for (const hero of spec.split(",").filter(Boolean)) {
      const entry = table.h[hero];
      if (!entry) { console.warn(`skilldemo: no hero ${hero}`); continue; }
      const [model, skills] = entry;
      await startPreview(scene, hero, fx, skills.map(sid => table.k[String(sid)][1]));
      heroes.push({ hero, model, disc: scene.isPlaceholder(PREVIEW_ACTOR), skills: skills.length });
      for (const sid of skills) {
        const [name, effects] = table.k[String(sid)];
        const anim = attackOf(fx, sid, effects).anim;
        scene.caption(`${hero} ${model}  ${name} ${sid}  ${anim}`);
        const t0 = performance.now();
        await scene.play([previewCast(fx, sid, effects)]);
        steps.push({ hero, model, skill: sid, name, anim, effects: effects.length, ms: Math.round(performance.now() - t0) });
        await wait(700);
      }
    }
  } finally {
    console.warn = warn;
  }
  scene.caption("演示结束");
  (window as unknown as { __skilldemo: { done: boolean } }).__skilldemo.done = true;
}

// Dev convenience: ?skillbtn=70501_5 (a hero's bid and star) stands the hero against the dummy and puts one temporary button over the page for each
// skill the hero has, in slot order: the normal attack first as 普攻, then named by kind: 主动1 被动1 主动2 被动2 ... (hero_skill_info.json). An
// active plays through the scene's own play() as in skilldemo; a passive has no cast animation in the client's tables, so its name and text show.
interface SkillInfo { h: { [heroStar: string]: number[] }; k: { [skill: string]: [string, string, string, number, string] } }

// ?skillbtn=70501_5:541314,541104 puts a button on each skill number after the colon instead of the hero's own, any skill number being playable.
export async function runSkillButtons(scene: BattleScene, spec: string): Promise<(sid: number) => void> {
  const [hero, extra] = spec.split(":");
  const [fx, table, info] = await Promise.all([loadJson<Fx>("tables/skill_fx.json"), loadJson<HeroSkills>("tables/hero_skills.json"), loadJson<SkillInfo>("tables/hero_skill_info.json")]);
  const [bid, star] = hero.split("_").map(Number);
  let key = hero, st = star;
  while (!info.h[key] && st > 1) key = `${bid}_${--st}`; // the highest star of the hero the table has at or below the one asked for
  const ids = extra ? extra.split(",").filter(Boolean).map(Number) : (info.h[key] ?? table.h[hero]?.[1] ?? []);
  const kinds = [0, 0]; // how many actives and passives have been named so far
  const buttons: [string, number][] = ids.map((id, i) => {
    if (!extra && i === 0) return ["普攻", id]; // the first skill of a hero is its normal attack
    const passive = info.k[String(id)]?.[3] ? 1 : 0;
    return [`${passive ? "被动" : "主动"}${++kinds[passive]}`, id];
  });
  const rowFor = (sid: number) => extra || !info.k[String(sid)]?.[3]
    ? table.a?.[String(sid)] ?? table.k[String(sid)]
    : undefined;
  await startPreview(scene, hero, fx, ids.map(sid => rowFor(sid)?.[1] ?? []));
  scene.caption(ids.length ? `${hero}  点按钮放技能` : `${hero}  暂无技能资料`);

  let busy = false;
  const cast = async (sid: number, label: string) => {
    if (busy) return;
    busy = true;
    try {
      const row = rowFor(sid);
      const [name, text] = info.k[String(sid)] ?? [row?.[0] ?? String(sid), ""];
      if (row) {
        const effects = row[1];
        scene.caption(`${label} ${name} ${sid}  ${attackOf(fx, sid, effects).anim}`);
        await scene.play([previewCast(fx, sid, effects)]);
      } else {
        scene.caption(`${label} ${name} ${sid}  ${text.length > 16 ? text.slice(0, 16) + "…" : text}`); // the caption is one line
      }
    } finally {
      busy = false;
    }
  };
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:50%;bottom:140px;transform:translateX(-50%);z-index:9999;display:flex;gap:8px";
  for (const [label, sid] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "padding:10px 14px;font-size:16px;border-radius:8px;border:2px solid #f8c23c;background:#4a3322;color:#fff";
    b.onclick = () => { void cast(sid, label).catch(e => console.warn(`skillbtn ${sid}: ${(e as Error).message}`)); };
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
  return sid => { const label = buttons.find(b => b[1] === sid)?.[0] ?? String(sid); void cast(sid, label).catch(e => console.warn(`skillbtn ${sid}: ${(e as Error).message}`)); };
}

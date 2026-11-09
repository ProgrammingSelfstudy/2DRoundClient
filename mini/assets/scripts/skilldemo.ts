// Dev convenience: ?skilldemo=10401_4 (a hero's bid and star) plays every active skill of that hero in turn on the battle scene, against a standing
// dummy (the first stage's pirate, H30012), with the skill's name, number and animation over the field. Several can be given, ?skilldemo=10401_4,10101_1.
// It uses the scene's own play(), so what it shows is what a fight shows. Progress is kept in window.__skilldemo for scripted checks.
import { loadJson } from "./cdn";
import { attackOf, effectInfo } from "./skillplan";
import type { Fx } from "./skillplan";
import type { BattleScene } from "./battlescene";
import type { Msg } from "./shared/proto/codec";

interface HeroSkills { h: { [heroStar: string]: [string, number[]] }; k: { [skill: string]: [string, number[]] } }
export interface DemoStep { hero: string; model: string; skill: number; name: string; anim: string; effects: number; ms: number }
export interface DemoHero { hero: string; model: string; disc: boolean; skills: number }

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const MINE = 2, THEIRS = 11; // positions: my front middle and the enemy's first, in the same row (the grid of battlescene.ts)
const HP = 1e9;

export async function runSkillDemo(scene: BattleScene, spec: string): Promise<void> {
  const [fx, table] = await Promise.all([loadJson<Fx>("tables/skill_fx.json"), loadJson<HeroSkills>("tables/hero_skills.json")]);
  const steps: DemoStep[] = [], heroes: DemoHero[] = [], warns: string[] = [];
  (window as unknown as { __skilldemo: unknown }).__skilldemo = { done: false, steps, heroes, warns };
  const warn = console.warn; // what the scene warns while a model loads (a file the release lacks) belongs to the hero on show
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); warn.apply(console, a); };
  for (const hero of spec.split(",").filter(Boolean)) {
    const entry = table.h[hero];
    if (!entry) { console.warn(`skilldemo: no hero ${hero}`); continue; }
    const [model, skills] = entry;
    const [bid, star] = hero.split("_").map(Number);
    const opening = {
      objects: [
        { object_type: 2, group: 1, pos: MINE, object_bid: bid, star, object_name: hero, hp: HP, hp_max: HP },
        { object_type: 3, group: 2, pos: THEIRS, object_bid: 101011, star: 1, object_name: "dummy", hp: HP, hp_max: HP },
      ],
    } as unknown as Msg;
    await scene.start(opening, 10008);
    scene.show(true);
    await wait(1500); // the models load while it waits; one that does not load turns into a disc
    heroes.push({ hero, model, disc: scene.isPlaceholder(MINE), skills: skills.length });
    for (const sid of skills) {
      const [name, effects] = table.k[String(sid)];
      const anim = attackOf(fx, sid, effects).anim;
      scene.caption(`${hero} ${model}  ${name} ${sid}  ${anim}`);
      const t0 = performance.now();
      await scene.play([{
        order: 1, actor: MINE, target: THEIRS, skill_bid: sid, talk_pos: 0, talk_content: "",
        effect_play: effects.map((effect_bid, i) => ({
          order: i + 1, actor: MINE, target: THEIRS, effect_bid, is_hit: 1, is_crit: 0, hp: HP,
          hp_changed: effectInfo(fx, effect_bid)?.noHurt ? 0 : -1000, is_dead: 0, buff_list: [],
        })),
      }] as unknown as Msg[]);
      steps.push({ hero, model, skill: sid, name, anim, effects: effects.length, ms: Math.round(performance.now() - t0) });
      await wait(700);
    }
  }
  console.warn = warn;
  scene.caption("演示结束");
  (window as unknown as { __skilldemo: { done: boolean } }).__skilldemo.done = true;
}

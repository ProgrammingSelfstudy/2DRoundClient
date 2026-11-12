// Dev page ?skilltune=70501_5 (as ?skillbtn=): a button per skill of the hero, and beside the field a panel for the skill cast last. Its sliders change
// the correction data of skilltune.ts live, "重播" casts the skill again, "保存" writes the corrections to pipeline/skill_tune.json through
// mini/serve.py (POST /tune/skill_tune.json), from where the next release build ships them as tables/skill_tune.json.
// What can be corrected: the playing speed of the attacker's animation (the hit lands later or sooner with it), its run to the target and back, and
// each effect model's offset, size and start delay. The original's values stay in the tables; a slider at its original value saves nothing.
import { runSkillButtons } from "./skilldemo";
import { MOVE_KEYS, animKey, applyMove, pruned, speedOf, tune } from "./skilltune";
import type { MoveKey } from "./skilltune";
import type { BattleScene, CastInfo } from "./battlescene";
import type { MovePlan } from "./skillplan";

const MOVE_RANGE: Record<MoveKey, [number, number, number, string]> = { // min, max, step, label
  delay: [0, 2, 0.01, "冲出延迟(秒)"], time: [0, 2, 0.01, "冲刺用时(秒)"], x: [-400, 400, 1, "冲到目标 x"], y: [-300, 300, 1, "冲到目标 y"],
  backDelay: [0, 2, 0.01, "回位延迟(秒)"], backTime: [0, 2, 0.01, "回位用时(秒)"], backX: [-400, 400, 1, "回位 x"],
};

export async function runSkillTune(scene: BattleScene, spec: string): Promise<void> {
  const cast = await runSkillButtons(scene, spec);
  const bases: { [key: string]: MovePlan } = {}; // the original's run of every animation cast so far, so a save drops the fields left at it
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:0;top:0;bottom:0;width:320px;overflow:auto;z-index:9999;background:#2b1f14ee;color:#fff;font:14px sans-serif;padding:10px";
  document.body.appendChild(box);
  let shown = "";

  const row = (parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) => {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0";
    const name = document.createElement("span");
    name.textContent = label;
    name.style.cssText = "width:96px;flex:none";
    const range = document.createElement("input");
    range.type = "range"; range.min = String(min); range.max = String(max); range.step = String(step); range.value = String(value);
    range.style.flex = "1";
    const num = document.createElement("input");
    num.type = "number"; num.step = String(step); num.value = String(value);
    num.style.cssText = "width:62px";
    const change = (v: number) => { if (Number.isFinite(v)) { set(v); range.value = String(v); num.value = String(v); } };
    range.oninput = () => change(Number(range.value));
    num.onchange = () => change(Number(num.value));
    line.append(name, range, num);
    parent.appendChild(line);
  };
  const title = (parent: HTMLElement, text: string) => {
    const t = document.createElement("div");
    t.textContent = text;
    t.style.cssText = "margin:10px 0 2px;font-weight:bold;color:#f8c23c";
    parent.appendChild(t);
  };
  const button = (parent: HTMLElement, text: string, on: () => void) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = "padding:8px 12px;margin:4px 4px 4px 0;font-size:15px;border-radius:6px;border:2px solid #f8c23c;background:#4a3322;color:#fff";
    b.onclick = on;
    parent.appendChild(b);
    return b;
  };

  const status = document.createElement("div");
  status.style.cssText = "margin:6px 0;min-height:20px;color:#9f9";

  const build = (c: CastInfo) => {
    box.textContent = "";
    const key = animKey(c.model, c.anim);
    bases[key] = c.base;
    const head = document.createElement("div");
    head.textContent = `技能 ${c.skill}  ${key}`;
    head.style.cssText = "font-size:16px;margin-bottom:6px";
    box.appendChild(head);
    button(box, "重播", () => cast(c.skill));
    button(box, "保存", () => {
      fetch("/tune/skill_tune.json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pruned(tune(), { move: bases })) })
        .then(r => { status.textContent = r.ok ? "已保存到 pipeline/skill_tune.json" : `保存失败 ${r.status}`; }, e => { status.textContent = `保存失败 ${(e as Error).message}`; });
    });
    button(box, "还原本技能", () => {
      delete tune().anim[key]; delete tune().move[key];
      for (const id of c.entities) delete tune().fx[String(id)];
      build(c);
    });
    box.appendChild(status);

    title(box, "动画速度(命中也随它提前或推后)");
    row(box, "速度倍数", 0.3, 2.5, 0.05, speedOf(c.model, c.anim), v => { (tune().anim[key] ??= {}).speed = v; });

    title(box, "冲向目标和回位");
    const now = applyMove(c.base, c.model, c.anim);
    for (const k of MOVE_KEYS) {
      const [min, max, step, label] = MOVE_RANGE[k];
      row(box, label, Math.min(min, now[k]), Math.max(max, now[k]), step, Number(now[k].toFixed(3)), v => { (tune().move[key] ??= {})[k] = v; });
    }

    for (const id of c.entities) {
      title(box, `特效 ${id}`);
      const t = tune().fx[String(id)] ?? {};
      const set = (f: "dx" | "dy" | "scale" | "delay") => (v: number) => { (tune().fx[String(id)] ??= {})[f] = v; };
      row(box, "左右 dx", -300, 300, 1, t.dx ?? 0, set("dx"));
      row(box, "上下 dy", -300, 300, 1, t.dy ?? 0, set("dy"));
      row(box, "大小倍数", 0.2, 3, 0.05, t.scale ?? 1, set("scale"));
      row(box, "延迟(秒)", 0, 2, 0.01, t.delay ?? 0, set("delay"));
    }
  };

  setInterval(() => { // a new cast: rebuild the panel for its skill
    const c = scene.lastCast;
    if (c && `${c.skill}/${c.model}/${c.anim}` !== shown) { shown = `${c.skill}/${c.model}/${c.anim}`; build(c); }
  }, 300);
  box.textContent = "先点左边的技能按钮放一次,再在这里调。";
}

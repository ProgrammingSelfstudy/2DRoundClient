// The battle scene, from the server's 20027 (who stands where) and 20004 (the attacks of a round): the stage's two background layers and
// every fighter's Spine animations at its grid cell. The grid is the original's (SkillAct.Pos2GridLeft / NormalPosGridRight; a cell is 1/80
// of the design width and height, the role layer sits 300 above the bottom). Skill effects, buffs and the elf come later.
import { Color, Graphics, HorizontalTextAlignment, Label, Node, Sprite, UITransform, Vec3, VerticalTextAlignment, sp, tween } from "cc";
import { loadJson, spriteFrame } from "./cdn";
import { spineData } from "./spine";
import { W, H } from "./loginpage";
import type { Msg } from "./shared/proto/codec";

interface Models { p: { [bidStar: string]: string }; u: { [unit: string]: [string, number] } }

// my side by position 1..11, and the enemies of a normal (campaign) battle by position - 9 (1..9, then 10)
const LEFT: number[][] = [[27, 15], [28, 21], [29, 27], [17, 15], [18, 21], [19, 27], [7, 15], [8, 21], [9, 27], [15, 43], [11, 39]];
const RIGHT_NORMAL: number[][] = [[42, 15], [42, 21], [42, 27], [42, 15], [42, 21], [42, 27], [42, 15], [42, 21], [42, 27], [42, 43]];
const ROLE_LAYER_Y = 300, FAR_Y = 736, GROUND_Y = 40;
const OBJECT_PARTNER = 2, OBJECT_UNIT = 3; // BattleObjectType; the elf (5) and the hallows come later

// the animation of a skill: the original's anime_user_atk of the skill's effect group (skill number // 10), table tables/skill_actions.json. A skill with
// no effect group (about one in seven of the server's skills) falls back to a guess by its number: ...001 action1, ...101 action2, ...201 action3, ...301 action5
const ACTIONS = ["action1", "action2", "action3", "action5"];
const guessAction = (skillBid: number) => ACTIONS[Math.min(ACTIONS.length - 1, Math.floor((skillBid % 1000) / 100))];
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const BAR_W = 80, BAR_H = 8;

export interface BattleScene {
  root: Node;
  start(opening: Msg, mapId: number): Promise<void>;
  play(skillPlays: Msg[]): Promise<void>; // one round's attacks (20004)
  round(n: number, max: number): void; // "第 n/max 回合" at the top, from the action count of 20002
  banner(text: string, win: boolean): void; // the result, over the field
  show(on: boolean): void;
  onTap(f: () => void): void;
}

// A fighter's position node holds the body (flipped for the second group; one Spine per action file, only the playing one shown), a
// hit-point bar and the floating numbers, which must not be flipped with the body.
interface Fighter {
  group: number; model: string; root: Node; body: Node; bar: Graphics;
  hp: number; hpMax: number; dead: boolean; ph: boolean; // ph: stands as a placeholder (no model, or none the release carries)
  files: Map<string, Promise<sp.Skeleton | null>>;
}

// the grid cell of a fighter: the original folds the two elf positions onto 10 and 11, and the second group counts from 10
function cell(group: number, pos: number): number[] {
  if (group === 1) return LEFT[(pos === 31 || pos === 32 ? 10 : pos === 41 || pos === 42 ? 11 : pos) - 1];
  return RIGHT_NORMAL[Math.max(1, pos - 9) - 1];
}

export async function buildBattleScene(canvas: Node): Promise<BattleScene> {
  const [models, skillActions] = await Promise.all([loadJson<Models>("tables/battle_models.json"), loadJson<{ [group: string]: string }>("tables/skill_actions.json")]);
  const actionOf = (skillBid: number) => skillActions[String(Math.floor(skillBid / 10))] ?? guessAction(skillBid);
  const root = new Node("battle_scene");
  root.layer = canvas.layer;
  const rt = root.addComponent(UITransform);
  rt.setContentSize(W, H);
  rt.setAnchorPoint(0, 0); // the whole screen takes the tap, its origin is the bottom-left corner
  root.setPosition(-W / 2, -H / 2, 0);
  root.active = false;
  canvas.addChild(root);
  const layer = (name: string, x: number, y: number) => {
    const n = new Node(name);
    n.layer = root.layer;
    n.addComponent(UITransform).setAnchorPoint(0, 0);
    n.setPosition(x, y, 0);
    root.addChild(n);
    return n;
  };
  const far = layer("far", 0, FAR_Y), ground = layer("ground", 0, GROUND_Y), roles = layer("roles", 0, ROLE_LAYER_Y);
  const top = layer("top", 0, 0); // the result banner, above the fighters
  const roundNode = layer("round", 0, 0); // the round counter, kept apart from the banner so a new fight can clear one without the other
  let tapped = () => {};
  root.on(Node.EventType.TOUCH_END, () => tapped());
  let token = 0;
  const fighters = new Map<number, Fighter>();

  const picture = async (parent: Node, logical: string) => {
    const s = parent.getComponent(Sprite) ?? parent.addComponent(Sprite); // a leftover Sprite of the last fight is reused: removeComponent only takes effect later
    s.spriteFrame = null;
    s.sizeMode = Sprite.SizeMode.RAW;
    try { s.spriteFrame = await spriteFrame(logical); } catch (e) { console.warn(`battle scene: ${(e as Error).message}`); }
  };

  const text = (parent: Node, str: string, size: number, color: Color, x: number, y: number) => {
    const n = new Node("text");
    n.layer = root.layer;
    n.addComponent(UITransform).setContentSize(360, size + 12);
    const l = n.addComponent(Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 6;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.color = color;
    l.enableOutline = true;
    l.outlineColor = new Color(0, 0, 0, 255);
    l.outlineWidth = 3;
    n.setPosition(x, y, 0);
    parent.addChild(n);
    return n;
  };

  const drawBar = (f: Fighter) => {
    const g = f.bar;
    g.clear();
    g.fillColor = new Color(30, 20, 10, 200);
    g.rect(-BAR_W / 2 - 1, -1, BAR_W + 2, BAR_H + 2);
    g.fill();
    g.fillColor = f.group === 1 ? new Color(90, 220, 90, 255) : new Color(230, 70, 60, 255);
    g.rect(-BAR_W / 2, 0, BAR_W * Math.max(0, Math.min(1, f.hp / f.hpMax)), BAR_H);
    g.fill();
  };

  // the Spine of one action file of a fighter, loaded the first time it is needed; null when the model has no usable file for it (the
  // original ships no picture for some, whose animation then lives in another file: H30012's action2 is inside its action1)
  const file = (f: Fighter, name: string): Promise<sp.Skeleton | null> => {
    if (f.ph) return Promise.resolve(null); // a placeholder has no Spine
    let p = f.files.get(name);
    if (!p) {
      p = (async () => {
        try {
          const n = new Node(name);
          n.layer = root.layer;
          n.addComponent(UITransform);
          const s = n.addComponent(sp.Skeleton);
          s.skeletonData = await spineData(`spine/hero/${f.model}/${name}`);
          s.premultipliedAlpha = false;
          n.active = false;
          f.body.addChild(n);
          return s;
        } catch (e) { console.warn(`battle scene: ${f.model}/${name}: ${(e as Error).message}`); return null; }
      })();
      f.files.set(name, p);
    }
    return p;
  };

  // find the skeleton that has animation `name`: its own file, else the first action's
  const skeletonFor = async (f: Fighter, name: string): Promise<{ s: sp.Skeleton; anim: string } | null> => {
    for (const fileName of [name, "action1"]) {
      const s = await file(f, fileName);
      if (s?.findAnimation(name)) return { s, anim: name };
    }
    const s = await file(f, "action1");
    return s ? { s, anim: "action1" } : null;
  };

  const showOnly = async (f: Fighter, s: sp.Skeleton) => {
    for (const p of Array.from(f.files.values())) { const o = await p; if (o && o !== s) o.node.active = false; }
    s.node.active = true;
  };

  // looping (standing) or once; a once-animation resolves when it ends and the fighter goes back to standing
  const perform = async (f: Fighter, name: string, loop: boolean): Promise<void> => {
    const found = await skeletonFor(f, name);
    if (!found && f.ph && !loop && !f.dead) { // a placeholder lunges at the other side instead of an action
      const x = f.body.position.x, d = f.group === 1 ? 40 : -40;
      await new Promise<void>(r => tween(f.body).to(0.15, { position: new Vec3(x + d, 0, 0) }).to(0.15, { position: new Vec3(x, 0, 0) }).call(() => r()).start());
      return;
    }
    if (!found || f.dead) return;
    await showOnly(f, found.s);
    if (loop) { found.s.setAnimation(0, found.anim, true); return; }
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2500); // never wait for an animation forever
      found.s.setCompleteListener(() => { clearTimeout(timer); resolve(); });
      found.s.setAnimation(0, found.anim, false);
    });
    if (!f.dead) await perform(f, "stand2", true);
  };

  // a fighter whose model the release does not carry stands as a disc with its name, so the fight can still be followed
  const placeholder = (f: Fighter, name: string) => {
    const g = new Node("placeholder");
    g.layer = root.layer;
    g.addComponent(UITransform);
    const gr = g.addComponent(Graphics);
    gr.fillColor = f.group === 1 ? new Color(70, 140, 220, 255) : new Color(200, 70, 60, 255);
    gr.circle(0, 60, 55);
    gr.fill();
    gr.strokeColor = new Color(255, 255, 255, 255);
    gr.lineWidth = 3;
    gr.circle(0, 60, 55);
    gr.stroke();
    f.body.addChild(g);
    f.ph = true;
    text(f.root, name, 24, new Color(255, 255, 255, 255), 0, 60); // on the position node, which is not flipped
  };

  const float = (f: Fighter, str: string, color: Color, big: boolean) => {
    const n = text(f.root, str, big ? 38 : 30, color, 0, 150);
    tween(n).to(0.7, { position: n.position.clone().add3f(0, 70, 0) }).call(() => n.destroy()).start();
  };

  const hit = async (e: Msg) => {
    const f = fighters.get(Number(e.target));
    if (!f) return;
    const change = Number(e.hp_changed);
    f.hp = Math.max(0, Number(e.hp));
    drawBar(f);
    if (change < 0) {
      float(f, String(-change), e.is_crit ? new Color(255, 200, 40, 255) : new Color(255, 255, 255, 255), Boolean(e.is_crit));
      if (Number(e.is_dead) === 1 || f.hp === 0) {
        await perform(f, "hurt", false);
        f.dead = true;
        f.root.active = false;
      } else void perform(f, "hurt", false);
    } else if (change > 0) float(f, `+${change}`, new Color(90, 255, 120, 255), false);
  };

  return {
    root,
    show(on) { root.active = on; },
    onTap(f) { tapped = f; },
    round(n, max) {
      roundNode.removeAllChildren();
      if (n > 0) text(roundNode, `第${n}/${max}回合`, 30, new Color(255, 240, 200, 255), W / 2, H - 150);
    },
    banner(str, win) {
      top.removeAllChildren();
      text(top, str, 64, win ? new Color(255, 220, 90, 255) : new Color(200, 200, 220, 255), W / 2, H / 2 + 100);
      text(top, "点一下返回", 28, new Color(255, 255, 255, 255), W / 2, H / 2 + 30);
    },
    async start(opening, mapId) {
      const mine = ++token;
      roles.removeAllChildren();
      top.removeAllChildren();
      roundNode.removeAllChildren();
      fighters.clear();
      await Promise.all([picture(far, `bg/battle/${mapId}/m_bg.webp`), picture(ground, `bg/battle/${mapId}/map_bg.webp`)]);
      for (const o of opening.objects as Msg[]) {
        const type = Number(o.object_type), group = Number(o.group), bid = Number(o.object_bid);
        const model = type === OBJECT_PARTNER ? models.p[`${bid}_${o.star}`] : type === OBJECT_UNIT ? models.u[String(bid)]?.[0] : undefined;
        const [gx, gy] = cell(group, Number(o.pos));
        const size = type === OBJECT_UNIT ? (models.u[String(bid)]?.[1] ?? 1000) / 1000 : 1;
        const fr = new Node(`fighter_${o.pos}`);
        fr.layer = root.layer;
        fr.addComponent(UITransform);
        fr.setPosition(gx * (W / 80), gy * (H / 80), 0);
        const body = new Node("body");
        body.layer = root.layer;
        body.addComponent(UITransform);
        body.setScale(group === 1 ? size : -size, size, 1); // the second group faces the first
        fr.addChild(body);
        const barNode = new Node("bar");
        barNode.layer = root.layer;
        barNode.addComponent(UITransform);
        barNode.setPosition(0, 130, 0);
        fr.addChild(barNode);
        const f: Fighter = { group, model: model ?? "", ph: false, root: fr, body, bar: barNode.addComponent(Graphics), hp: Number(o.hp), hpMax: Math.max(1, Number(o.hp_max)), dead: false, files: new Map() };
        drawBar(f);
        fighters.set(Number(o.pos), f);
        if (mine !== token) return;
        roles.addChild(fr);
        if (!model) placeholder(f, String(o.object_name || bid));
        else {
          // a model the release does not carry (its stand file will not load) is replaced by the placeholder
          void skeletonFor(f, "stand2").then(found => { if (!found && mine === token && !f.dead) placeholder(f, String(o.object_name || bid)); });
          void perform(f, "stand2", true);
        }
      }
    },
    // the attacks of a round in their order: the attacker plays its action, the hits land partway through it
    async play(plays) {
      const mine = token;
      for (const p of [...plays].sort((a, b) => Number(a.order) - Number(b.order))) {
        if (mine !== token) return;
        const actor = fighters.get(Number(p.actor));
        if (!actor || actor.dead) continue;
        const swing = perform(actor, actionOf(Number(p.skill_bid)), false);
        await wait(450);
        await Promise.all((p.effect_play as Msg[]).map(hit));
        await swing;
        await wait(200);
      }
    },
  };
}

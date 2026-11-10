// The battle scene, from the server's 20027 (who stands where) and 20004 (the attacks of a round): the stage's two background layers and
// every fighter's Spine animations at its grid cell. The grid is the original's (SkillAct.Pos2GridLeft / NormalPosGridRight; a cell is 1/80
// of the design width and height, the role layer sits 300 above the bottom). How a skill is played (its animation, the run to the target and back, the
// screen shake, hurt or not) is worked out by skillplan.ts from tables/skill_fx.json; this file carries it out. Skill effects and the elf come later.
import { Color, Graphics, HorizontalTextAlignment, Label, Node, Sprite, Tween, UIOpacity, UITransform, Vec3, VerticalTextAlignment, sp, tween } from "cc";
import { hasFile, loadJson, spriteFrame } from "./cdn";
import { setModel, spineData, spineNode } from "./spine";
import { W, H } from "./design";
import { attackOf, backTarget, blackOf, effectInfo, hitEvent, hitShare, movePlan, moveTarget, shakeSteps } from "./skillplan";
import type { Cell, Fx, MovePlan } from "./skillplan";
import { FxList, entitiesOf, playEntity } from "./skillfx";
import type { FxRes, FxSpot } from "./skillfx";
import type { Msg } from "./shared/proto/codec";

interface Models { p: { [bidStar: string]: string }; u: { [unit: string]: [string, number] } }

// my side by position 1..11, and the enemies of a normal (campaign) battle by position - 9 (1..9, then 10)
const LEFT: number[][] = [[27, 15], [28, 21], [29, 27], [17, 15], [18, 21], [19, 27], [7, 15], [8, 21], [9, 27], [15, 43], [11, 39]];
const RIGHT_NORMAL: number[][] = [[42, 15], [42, 21], [42, 27], [42, 15], [42, 21], [42, 27], [42, 15], [42, 21], [42, 27], [42, 43]];
const ROLE_LAYER_Y = 300, FAR_Y = 736, GROUND_Y = 40;
const OBJECT_PARTNER = 2, OBJECT_UNIT = 3; // BattleObjectType; the elf (5) and the hallows come later

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const BAR_W = 80, BAR_H = 8;
const ACTION_FILES = ["action", "action1", "action2", "action3", "action4", "action5", "action6", "action7", "action8", "action9"];

interface Hooks { hit?: (k: number) => void; move?: () => void; back?: () => void; shake?: () => void; ready?: () => void; attack?: () => void }

export interface BattleScene {
  root: Node;
  start(opening: Msg, mapId: number): Promise<void>;
  play(skillPlays: Msg[]): Promise<void>; // one round's attacks (20004)
  round(n: number, max: number): void; // "第 n/max 回合" at the top, from the action count of 20002
  caption(text: string): void; // any line at the same place, for the skill demo
  isPlaceholder(pos: number): boolean; // whether the fighter at a position stands as a disc (its model did not load), for the skill demo
  banner(text: string, win: boolean): void; // the result, over the field
  show(on: boolean): void;
  onTap(f: () => void): void;
}

// A fighter's position node holds the body (flipped for the second group; one Spine per action file, only the playing one shown), a
// hit-point bar and the floating numbers, which must not be flipped with the body.
interface Fighter {
  group: number; type: number; bid: number; model: string; root: Node; body: Node; bar: Graphics;
  hp: number; hpMax: number; dead: boolean; buffs: Map<number, number>; status: Label; // buffs: buff id -> bid of the statuses on it, status: their names over the bar
  ph: boolean; // ph: stands as a placeholder (no model, or none the release carries)
  home: Cell; side: number; row: number; // its grid cell, +1 for the first group and -1 for the second, its row 1..3 (the original's obj_type and col)
  seq: number; // counts the animations started on it, so a finished one only returns to standing when no newer one has begun
  files: Map<string, Promise<sp.Skeleton | null>>;
}

// the grid cell of a fighter: the original folds the two elf positions onto 10 and 11, and the second group counts from 10
function cell(group: number, pos: number): number[] {
  if (group === 1) return LEFT[(pos === 31 || pos === 32 ? 10 : pos === 41 || pos === 42 ? 11 : pos) - 1];
  return RIGHT_NORMAL[Math.max(1, pos - 9) - 1];
}

export async function buildBattleScene(canvas: Node): Promise<BattleScene> {
  const [models, fx, fxRes, buffTable, skillNames] = await Promise.all([
    loadJson<Models>("tables/battle_models.json"),
    loadJson<Fx>("tables/skill_fx.json"),
    loadJson<FxRes>("tables/skill_fx_res.json").catch(() => null), // a release without the effect table plays no skill effects
    loadJson<{ [bid: string]: [string, number] }>("tables/buffs.json"), // buff bid -> name, 1 benefit / 2 harm
    loadJson<{ k: { [skill: string]: [string] } }>("tables/hero_skill_info.json").catch(() => null), // skill bid -> name, for the skill-name banner
  ]);
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
  // the ground picture is transparent in its lowest 114 rows (the original's battle UI covers them); a floor in its colour keeps the city scene from showing there
  const floorNode = layer("floor", 0, 0);
  const floor = floorNode.addComponent(Graphics);
  floor.fillColor = new Color(118, 124, 58, 255);
  floor.rect(0, 0, W, 170);
  floor.fill();
  const far = layer("far", 0, FAR_Y), ground = layer("ground", 0, GROUND_Y), blackLayer = layer("black", 0, 0), fxBelow = layer("fx_below", 0, ROLE_LAYER_Y), roles = layer("roles", 0, ROLE_LAYER_Y), fxAbove = layer("fx_above", 0, ROLE_LAYER_Y);
  // the effect layers sit as high as the role layer (battle_scene_view.lua: effect_layer_1 and _2 at map_init_y), so a scene effect's place is
  // counted from the fighters' ground line, not from the bottom of the screen
  // the darkening of a big skill (BattleSceneNewView.setBlack: a black layer over the map, under the fighters, fading in over 0.2 s)
  const blackG = blackLayer.addComponent(Graphics);
  const blackOpacity = blackLayer.addComponent(UIOpacity);
  blackLayer.active = false;
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

  // the line of status names over a fighter's hit-point bar; the position node is not flipped, so the text reads the right way
  const statusLabel = (parent: Node) => {
    const n = new Node("status");
    n.layer = root.layer;
    n.addComponent(UITransform).setContentSize(220, 22);
    n.setPosition(0, 152, 0);
    const l = n.addComponent(Label);
    l.string = ""; // a Label starts as "label"
    l.fontSize = 18;
    l.lineHeight = 22;
    l.overflow = Label.Overflow.NONE;
    l.color = new Color(255, 235, 150, 255);
    l.enableOutline = true;
    l.outlineColor = new Color(0, 0, 0, 255);
    l.outlineWidth = 2;
    parent.addChild(n);
    return l;
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
          setModel(s, await spineData(`spine/hero/${f.model}/${name}`));
          n.active = false;
          f.body.addChild(n);
          return s;
        } catch (e) { console.warn(`battle scene: ${f.model}/${name}: ${(e as Error).message}`); return null; }
      })();
      f.files.set(name, p);
    }
    return p;
  };

  // find the skeleton that has animation `name`: its own file, else action1's, else any other action file of the model (the original ships some
  // animations inside another file: H30021's action3 is in action2.json); the files the release lacks are not tried
  const skeletonFor = async (f: Fighter, name: string): Promise<{ s: sp.Skeleton; anim: string } | null> => {
    const own = f.ph ? [] : [name, "action1", ...ACTION_FILES.filter(n => n !== name && n !== "action1")].filter(n => hasFile(`spine/hero/${f.model}/${n}.json`));
    for (const fileName of own) {
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

  // looping (standing) or once; a once-animation resolves when it ends and the fighter goes back to standing. `on.hit(k)` fires at each of the
  // animation's "hit" events, k counting from 1 (the original lands the damage there, setAnimationWithEvent); an animation with none, or one that
  // never plays, fires `on.hit(1)` when it ends. `on.move`, `on.back` and `on.shake` are its "move", "back" and "shake_point" events
  const perform = async (f: Fighter, name: string, loop: boolean, on?: Hooks): Promise<void> => {
    let ticks = 0;
    const tick = () => { ticks++; on?.hit?.(ticks); };
    const land = () => { if (ticks === 0) tick(); };
    const mine = ++f.seq;
    const found = await skeletonFor(f, name);
    if (!found && f.ph && !loop && !f.dead) { // a placeholder lunges at the other side instead of an action; the lunge is its hit
      const x = f.body.position.x, d = f.group === 1 ? 40 : -40;
      await new Promise<void>(r => tween(f.body).to(0.15, { position: new Vec3(x + d, 0, 0) }).call(land).to(0.15, { position: new Vec3(x, 0, 0) }).call(() => r()).start());
      return;
    }
    if (!found || f.dead) { land(); return; }
    await showOnly(f, found.s);
    if (loop) { found.s.setAnimation(0, found.anim, true); return; }
    // the damage lands on the animation's hit event, or on its attack event when it has no hit (the area skills); it may run past 2 s (a
    // finishing move), so the wait for its end is its own length and a little more
    const json = found.s.skeletonData?.skeletonJson as { animations?: { [a: string]: { events?: { name: string }[] } } } | undefined;
    const landOn = hitEvent((json?.animations?.[found.anim]?.events ?? []).map(e => e.name));
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, (found.s.findAnimation(found.anim)?.duration ?? 2) * 1000 + 500); // never wait for an animation forever
      found.s.setEventListener((_entry, event) => {
        const n = event.data.name.toLowerCase();
        if (n === "attack") on?.attack?.(); // the original's attackPoint, whether or not the damage lands on this event too
        if (n === landOn) tick();
        else if (n === "ready") on?.ready?.();
        else if (n === "move") on?.move?.();
        else if (n === "back") on?.back?.();
        else if (n === "shake_point") on?.shake?.();
      });
      found.s.setCompleteListener(() => { clearTimeout(timer); resolve(); });
      found.s.setAnimation(0, found.anim, false);
    });
    land();
    if (!f.dead && f.seq === mine) await perform(f, "stand2", true); // a hurt that ends late must not cut off the attack that began after it
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

  // buff_list of an effect: action 1 adds a status (its name floats up, green for a benefit, red for a harm), 2 takes it off, 3 only refreshes its rounds
  const applyBuffs = (e: Msg) => {
    const list = e.buff_list as Msg[] | undefined;
    if (!list) return;
    for (const b of list) {
      const f = fighters.get(Number(b.target));
      if (!f) continue;
      const info = buffTable[String(b.buff_bid)], action = Number(b.action_type);
      if (action === 2) f.buffs.delete(Number(b.id));
      else {
        if (action === 1 && info && !f.buffs.has(Number(b.id))) float(f, info[0], info[1] === 2 ? new Color(255, 110, 100, 255) : new Color(120, 255, 140, 255), false);
        f.buffs.set(Number(b.id), Number(b.buff_bid));
      }
      f.status.string = Array.from(new Set(Array.from(f.buffs.values()).map(bid => buffTable[String(bid)]?.[0]).filter(Boolean))).join(" ");
    }
  };

  const cellPos = (c: Cell) => new Vec3(c[0] * (W / 80), c[1] * (H / 80), 0);

  // the fighter runs to a cell: the original's moveTo / moveBack, an exponential ease out that starts after a delay
  const runTo = (f: Fighter, c: Cell, delay: number, time: number) => {
    Tween.stopAllByTarget(f.root);
    return new Promise<void>(r => tween(f.root).delay(delay).to(time, { position: cellPos(c) }, { easing: "expoOut" }).call(() => r()).start());
  };

  // the skill-name banner (BattleSceneNewView.showSkillName): a 470 by 190 board at the middle of the field, 550 up from the role layer, with the
  // banner's Spine (effect 276, E31321: action2 for the first group, action1 for the second), the hero's head sliding in from the left and the skill's
  // name from the right (0.08 s, fading in over 0.1 s). The skill starts 0.3 s after it appears, and it goes 0.5 s after that (battle_act_data.lua
  // skill_bg_* and skill_name_delay_time*, in 1/100 s)
  const board = new Node("skill_name");
  board.layer = root.layer;
  board.addComponent(UITransform).setContentSize(470, 190);
  board.setPosition(W / 2, 550, 0);
  board.active = false;
  fxAbove.addChild(board);
  const headNode = new Node("head");
  headNode.layer = root.layer;
  headNode.addComponent(UITransform);
  const headSprite = headNode.addComponent(Sprite);
  headSprite.sizeMode = Sprite.SizeMode.RAW;
  headNode.setScale(0.4, 0.4, 1);
  const headOpacity = headNode.addComponent(UIOpacity);
  const nameNode = text(board, "", 30, new Color(255, 255, 255, 255), 0, 0);
  const nameOpacity = nameNode.addComponent(UIOpacity);
  const lastBanner = new Map<Fighter, number>(); // the skill the banner last showed for a fighter (temp_skill_bid): the same skill again shows none
  const bannerSpine = new Map<number, Promise<sp.Skeleton | null>>();
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  const showSkillName = async (f: Fighter, skillBid: number): Promise<void> => {
    const name = skillNames?.k[String(skillBid)]?.[0];
    if (f.type !== OBJECT_PARTNER || !name || (fx.n ?? []).indexOf(skillBid) >= 0 || !hasFile(`icons/head/${f.bid}.webp`)) return;
    if (lastBanner.get(f) === skillBid) return;
    lastBanner.set(f, skillBid);
    try { headSprite.spriteFrame = await spriteFrame(`icons/head/${f.bid}.webp`); } catch { return; }
    (nameNode.getComponent(Label) as Label).string = name;
    // the board's own pieces sit in container coordinates (origin at its bottom left): head 114 -> 173, name 425 -> 267 (heights 102)
    const at = (x: number, y: number) => new Vec3(x - 235, y - 95, 0);
    if (!headNode.parent) board.addChild(headNode);
    Tween.stopAllByTarget(headNode);
    Tween.stopAllByTarget(nameNode);
    Tween.stopAllByTarget(headOpacity);
    Tween.stopAllByTarget(nameOpacity);
    headNode.setPosition(at(114, 102));
    nameNode.setPosition(at(425, 102));
    headOpacity.opacity = 0;
    nameOpacity.opacity = 0;
    board.active = true;
    tween(headNode).to(0.08, { position: at(173, 102) }).start();
    tween(nameNode).to(0.08, { position: at(267, 102) }).start();
    tween(headOpacity).to(0.1, { opacity: 255 }).start();
    tween(nameOpacity).to(0.1, { opacity: 255 }).start();
    // the board's Spine, loaded the first time and replayed after that
    let sk = bannerSpine.get(f.group);
    if (!sk) {
      const holder = new Node("banner_spine");
      holder.layer = root.layer;
      holder.addComponent(UITransform);
      holder.setPosition(at(235, 100));
      board.addChild(holder);
      holder.setSiblingIndex(0);
      sk = spineNode("spine/fx/E31321/action", f.group === 1 ? "action2" : "action1", holder).then(s => s, () => null);
      bannerSpine.set(f.group, sk);
    }
    const s = await sk;
    if (s?.isValid) { s.node.active = true; s.setAnimation(0, f.group === 1 ? "action2" : "action1", false); }
    await wait(300);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { board.active = false; }, 500);
  };

  let hidden: Fighter[] = []; // the fighters a black screen keeps out of sight until it ends
  const blackOn = (alpha: number, others: Fighter[]) => {
    blackG.clear();
    blackG.fillColor = new Color(0, 0, 0, alpha);
    blackG.rect(-100, -100, W + 200, H + 200);
    blackG.fill();
    blackLayer.active = true;
    Tween.stopAllByTarget(blackOpacity);
    blackOpacity.opacity = 0;
    tween(blackOpacity).to(0.2, { opacity: 255 }).start();
    hidden = others;
    for (const o of others) o.root.getComponent(UIOpacity)?.destroy(), o.root.addComponent(UIOpacity).opacity = 0;
  };
  // cancleBlackScreen: the field and the fighters are as they were
  const blackOff = () => {
    Tween.stopAllByTarget(blackOpacity);
    blackLayer.active = false;
    for (const o of hidden) o.root.getComponent(UIOpacity)?.destroy();
    hidden = [];
  };

  // after its attack a fighter is back in its own cell, however the animation's events went
  const settle = async (f: Fighter) => {
    if (!f.dead && Vec3.distance(f.root.position, cellPos(f.home)) > 1) await runTo(f, f.home, 0, 0.1);
  };

  // the screen shake of a shake id: the field's layers step through the offsets of shakeSteps; one shake at a time, as the original has it
  let shaking = false;
  const shake = async (shakeId: number) => {
    const steps = shakeSteps(fx, shakeId);
    if (shaking || !steps.length) return;
    shaking = true;
    const mine = token, layers = [far, ground, blackLayer, fxBelow, roles, fxAbove], base = layers.map(n => n.position.clone());
    for (const st of steps) {
      if (mine !== token) break;
      layers.forEach((n, i) => n.setPosition(base[i].x + st.x, base[i].y + st.y, 0));
      await wait(st.wait * 1000);
    }
    layers.forEach((n, i) => n.setPosition(base[i]));
    shaking = false;
  };

  // a dodged hit: no damage, the fighter steps out of the way and back (SkillAct.miss)
  const dodge = (f: Fighter) => {
    float(f, "闪避", new Color(255, 255, 255, 255), false);
    const x = f.body.position.x, d = f.group === 1 ? -30 : 30;
    tween(f.body).to(0.12, { position: new Vec3(x + d, 0, 0) }).to(0.12, { position: new Vec3(x, 0, 0) }).start();
  };

  // hit k of n of an effect: the effect's damage is split into n hits (the effect row's split_hurt), each showing hitShare of it; the target is shown
  // hurt at the first, and its hit points, death, statuses and the rest wait for the last, as in BattleModel.playMagic
  const hit = async (e: Msg, k = 1, n = 1) => {
    const last = k === n;
    const f = fighters.get(Number(e.target));
    if (last) applyBuffs(e);
    if (!f) return;
    if (Number(e.is_hit) === 0) { if (k === 1) dodge(f); return; }
    const noHurt = effectInfo(fx, Number(e.effect_bid))?.noHurt ?? false; // the effect row says whether the target is shown hurt
    const change = Number(e.hp_changed);
    const share = hitShare(change, n);
    f.hp = last ? Math.max(0, Number(e.hp)) : Math.max(1, f.hp + share); // after the last hit it is the server's, so rounding in the parts leaves no drift
    drawBar(f);
    if (change < 0) {
      float(f, String(-share), e.is_crit ? new Color(255, 200, 40, 255) : new Color(255, 255, 255, 255), Boolean(e.is_crit));
      if (last && (Number(e.is_dead) === 1 || f.hp === 0)) {
        await perform(f, "hurt", false);
        f.dead = true;
        f.root.active = false;
      } else if (k === 1 && !noHurt) void perform(f, "hurt", false);
    } else if (change > 0) float(f, `+${share}`, new Color(90, 255, 120, 255), false);
  };

  return {
    root,
    show(on) { root.active = on; },
    onTap(f) { tapped = f; },
    round(n, max) {
      roundNode.removeAllChildren();
      if (n > 0) text(roundNode, `第${n}/${max}回合`, 30, new Color(255, 240, 200, 255), W / 2, H - 150);
    },
    isPlaceholder(pos) { return fighters.get(pos)?.ph ?? false; },
    caption(str) {
      roundNode.removeAllChildren();
      text(roundNode, str, 26, new Color(255, 240, 200, 255), W / 2, H - 150);
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
      blackOff();
      board.active = false;
      lastBanner.clear();
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
        const f: Fighter = { group, type, bid, model: model ?? "", ph: false, seq: 0, home: [gx, gy], side: group === 1 ? 1 : -1, row: Math.max(1, Math.min(3, Math.round((gy - 9) / 6))), buffs: new Map(), status: statusLabel(fr), root: fr, body, bar: barNode.addComponent(Graphics), hp: Number(o.hp), hpMax: Math.max(1, Number(o.hp_max)), dead: false, files: new Map() };
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
    // the attacks of a round in their order: the attacker plays its action, runs to the first enemy it hits on the animation's move event and back on
    // its back event, the screen shakes on shake_point, and the hits land on its hit events, one part of an effect's split damage at each (parts the
    // animation has no event for land together when it ends, so the total always lands)
    async play(plays) {
      const mine = token;
      for (const p of [...plays].sort((a, b) => Number(a.order) - Number(b.order))) {
        if (mine !== token) return;
        const actor = fighters.get(Number(p.actor));
        if (!actor || actor.dead) continue;
        const effects = p.effect_play as Msg[];
        const attack = attackOf(fx, Number(p.skill_bid), effects.map(e => Number(e.effect_bid)));
        const victim = effects.map(e => fighters.get(Number(e.target))).find(t => t && t.group !== actor.group);
        await showSkillName(actor, Number(p.skill_bid));
        if (mine !== token) return;
        const plan: MovePlan = movePlan(fx, actor.model, attack.animeRes, attack.anim);
        const shakeId = effects.map(e => effectInfo(fx, Number(e.effect_bid))?.shakeId ?? 0).find(id => id !== 0) ?? 0;
        const parts = effects.map(e => ({ e, n: effectInfo(fx, Number(e.effect_bid))?.splitHurt ?? 1, done: 0 }));
        const pending: Promise<void>[] = [];
        // the skill's effect models: the lists of its effect rows play at the animation's ready, attack (with the scene's area effects) and first hit
        const spot = (f: Fighter): FxSpot => ({ root: f.root, side: f.side, height: 150 });
        const bids = effects.map(e => Number(e.effect_bid));
        const targets = effects.map(e => fighters.get(Number(e.target))).filter((t): t is Fighter => !!t && t.group !== actor.group);
        const playFx = (list: number, onTargets: boolean) => {
          if (!fxRes) return;
          for (const id of entitiesOf(fxRes, bids, list)) {
            if (onTargets) for (const t of new Set(targets)) playEntity(fxRes, id, list, spot(actor), spot(t), { above: fxAbove, below: fxBelow });
            else playEntity(fxRes, id, list, spot(actor), victim ? spot(victim) : undefined, { above: fxAbove, below: fxBelow });
          }
        };
        // the skill's black screen: from its delay until the attacker is done
        const black = blackOf(fx, bids);
        let blackTimer: ReturnType<typeof setTimeout> | undefined;
        if (black) {
          const others = black.hideOthers ? Array.from(fighters.values()).filter(o => o !== actor && !o.dead && targets.indexOf(o) < 0) : [];
          blackTimer = setTimeout(() => { if (mine === token) blackOn(black.alpha, others); }, black.delay * 1000);
        }
        let hitFx = false;
        const land = () => {
          if (!hitFx) { hitFx = true; playFx(FxList.hit, true); }
          for (const part of parts) if (part.done < part.n) pending.push(hit(part.e, ++part.done, part.n));
        };
        const swing = perform(actor, attack.anim, false, {
          hit: land,
          ready: () => playFx(FxList.ready, false),
          attack: () => { playFx(FxList.attack, false); playFx(FxList.area, false); },
          move: () => {
            if (!victim || actor.ph) return; // no enemy to run to (a heal or a status), or a disc, which lunges by itself
            actor.root.setSiblingIndex(roles.children.length); // to the top, so it runs over the others
            void runTo(actor, moveTarget(plan, actor.side, actor.home, victim.home, actor.row), plan.delay, plan.time);
          },
          back: () => { if (victim && !actor.ph) void runTo(actor, backTarget(plan, actor.side, actor.home, victim.home), plan.backDelay, plan.backTime); },
          shake: () => { if (shakeId) void shake(shakeId); },
        });
        await swing;
        while (parts.some(part => part.done < part.n)) land();
        await Promise.all(pending);
        if (black) { clearTimeout(blackTimer); blackOff(); }
        await settle(actor);
        await wait(200);
      }
    },
  };
}

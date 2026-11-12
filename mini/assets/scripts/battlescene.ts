// The battle scene, from the server's 20027 (who stands where) and 20004 (the attacks of a round): the stage's two background layers and
// every fighter's Spine animations at its grid cell. The grid is the original's (SkillAct.Pos2GridLeft / NormalPosGridRight; a cell is 1/80
// of the design width and height, the role layer sits 300 above the bottom). How a skill is played (its animation, the run to the target and back, the
// screen shake, hurt or not) is worked out by skillplan.ts from tables/skill_fx.json; this file carries it out. Skill effects and the elf come later.
import { Color, Director, Graphics, HorizontalTextAlignment, Label, Node, Sprite, Tween, UIOpacity, UITransform, Vec3, VerticalTextAlignment, director, sp, tween } from "cc";
import { hasFile, loadJson, spriteFrame } from "./cdn";
import { setModel, spineData, spineNode } from "./spine";
import { W, H } from "./design";
import { attackOf, backTarget, blackOf, effectInfo, hitEvent, hitShare, movePlan, moveTarget, previewCell, previewZOrder, shakeSteps } from "./skillplan";
import type { Cell, Fx, MovePlan } from "./skillplan";
import { FxList, entitiesOf, playEntity } from "./skillfx";
import type { FxRes, FxSpot } from "./skillfx";
import { applyMove, hitShiftOf, loadTune, speedOf } from "./skilltune";
import type { Tune } from "./skilltune";
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

interface Hooks { landed?: (k: number, seconds: number) => void; landTimes?: (seconds: number[]) => void; hit?: (k: number) => void; move?: () => void; back?: () => void; shake?: () => void; ready?: () => void; attack?: () => void }

export interface BattleScene {
  root: Node;
  start(opening: Msg, mapId: number): Promise<void>;
  play(skillPlays: Msg[]): Promise<void>; // one round's attacks (20004)
  stop(): void;
  round(n: number, max: number): void; // "第 n/max 回合" at the top, from the action count of 20002
  caption(text: string): void; // any line at the same place, for the skill demo
  isPlaceholder(pos: number): boolean; // whether the fighter at a position stands as a disc (its model did not load), for the skill demo
  banner(text: string, win: boolean): void; // the result, over the field
  show(on: boolean): void;
  onTap(f: () => void): void;
  lastCast: CastInfo | null; // the skill played last, for the ?skilltune= page
}

// what the tuning page needs to know of the skill just played: whose animation, the original's run before any correction, the effect entities
export interface CastInfo { landed: number[]; hits: number[]; model: string; anim: string; animeRes: string; base: MovePlan; entities: number[]; skill: number }

// A fighter's position node holds the body (flipped for the second group; one Spine per action file, only the playing one shown), a
// hit-point bar and the floating numbers, which must not be flipped with the body.
interface BattleVitals {
  hp: number; hpMax: number; bar: Graphics; buffs: Map<number, number>; status: Label;
}
interface Fighter {
  group: number; type: number; bid: number; model: string; root: Node; body: Node; vitals: BattleVitals | null;
  dead: boolean;
  ph: boolean; // ph: stands as a placeholder (no model, or none the release carries)
  home: Cell; side: number; row: number; // its grid cell, +1 for the first group and -1 for the second, its row 1..3 (the original's obj_type and col)
  zOrder: number; // the original renderer depth, tracked only in the preview
  seq: number; // counts the animations started on it, so a finished one only returns to standing when no newer one has begun
  files: Map<string, Promise<sp.Skeleton | null>>;
}

// the grid cell of a fighter: the original folds the two elf positions onto 10 and 11, and the second group counts from 10
function cell(group: number, pos: number): number[] {
  if (group === 1) return LEFT[(pos === 31 || pos === 32 ? 10 : pos === 41 || pos === 42 ? 11 : pos) - 1];
  return RIGHT_NORMAL[Math.max(1, pos - 9) - 1];
}

export async function buildBattleScene(canvas: Node, mode: "battle" | "preview" = "battle"): Promise<BattleScene> {
  const preview = mode === "preview";
  const [, models, fx, fxRes, buffTable, skillNames] = await Promise.all([
    loadTune(() => loadJson<Tune>("tables/skill_tune.json")),
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
  let lastCast: CastInfo | null = null;
  root.on(Node.EventType.TOUCH_END, () => tapped());
  let token = 0;
  const fighters = new Map<number, Fighter>();
  const sortPreviewRoles = () => {
    Array.from(fighters.values()).sort((a, b) => a.zOrder - b.zOrder || a.root.getSiblingIndex() - b.root.getSiblingIndex())
      .forEach((f, i) => f.root.setSiblingIndex(i));
  };
  const resetPreviewZOrder = (f: Fighter, pos: number) => {
    const zOrder = previewZOrder(pos);
    if (f.zOrder === zOrder) return;
    f.zOrder = zOrder;
    // Cocos2d-x sorts ties by arrival, and changing the local Z updates arrival order.
    f.root.setSiblingIndex(roles.children.length - 1);
    sortPreviewRoles();
  };

  const picture = async (parent: Node, logical: string) => {
    const mine = token;
    const s = parent.getComponent(Sprite) ?? parent.addComponent(Sprite); // a leftover Sprite of the last fight is reused: removeComponent only takes effect later
    s.spriteFrame = null;
    s.sizeMode = Sprite.SizeMode.RAW;
    try {
      const frame = await spriteFrame(logical);
      if (mine === token) s.spriteFrame = frame;
    } catch (e) { console.warn(`battle scene: ${(e as Error).message}`); }
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

  const drawBar = (f: Fighter, vitals: BattleVitals) => {
    const g = vitals.bar;
    g.clear();
    g.fillColor = new Color(30, 20, 10, 200);
    g.rect(-BAR_W / 2 - 1, -1, BAR_W + 2, BAR_H + 2);
    g.fill();
    g.fillColor = f.group === 1 ? new Color(90, 220, 90, 255) : new Color(230, 70, 60, 255);
    g.rect(-BAR_W / 2, 0, BAR_W * Math.max(0, Math.min(1, vitals.hp / vitals.hpMax)), BAR_H);
    g.fill();
  };

  // the Spine of one action file of a fighter, loaded the first time it is needed; null when the model has no usable file for it (the
  // original ships no picture for some, whose animation then lives in another file: H30012's action2 is inside its action1)
  const file = (f: Fighter, name: string): Promise<sp.Skeleton | null> => {
    if (f.ph) return Promise.resolve(null); // a placeholder has no Spine
    let p = f.files.get(name);
    if (!p) {
      const mine = token;
      p = (async () => {
        const n = new Node(name);
        try {
          n.layer = root.layer;
          n.addComponent(UITransform);
          const s = n.addComponent(sp.Skeleton);
          const data = await spineData(`spine/hero/${f.model}/${name}`);
          if (mine !== token || !f.body.isValid) { n.destroy(); return null; }
          setModel(s, data);
          if (preview) s.timeScale = 1.2; // Original battle_act_data.speed_scale_1 (the X1 setting).
          n.active = false;
          f.body.addChild(n);
          return s;
        } catch (e) {
          n.destroy();
          console.warn(`battle scene: ${f.model}/${name}: ${(e as Error).message}`);
          return null;
        }
      })();
      f.files.set(name, p);
    }
    return p;
  };

  // find the skeleton that has animation `name`: its own file, else action1's, else any other action file of the model (the original ships some
  // animations inside another file: H30021's action3 is in action2.json); the files the release lacks are not tried
  const skeletonFor = async (f: Fighter, name: string, animeRes?: string): Promise<{ s: sp.Skeleton; anim: string } | null> => {
    const own = f.ph ? [] : Array.from(new Set([animeRes || name, name, "action1", ...ACTION_FILES])).filter(n => hasFile(`spine/hero/${f.model}/${n}.json`));
    for (const fileName of own) {
      const s = await file(f, fileName);
      if (s?.findAnimation(name)) return { s, anim: name };
      if (preview && animeRes && fileName === animeRes) return null;
    }
    if (preview && name === "stand2" && hasFile(`spine/hero/${f.model}/show.json`)) {
      const pose = await file(f, "show");
      if (pose?.findAnimation("show")) return { s: pose, anim: "show" };
    }
    if (preview) return null;
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
  const perform = async (f: Fighter, name: string, loop: boolean, on?: Hooks, animeRes?: string, reverse = false, restorePose = true): Promise<void> => {
    const generation = token;
    let ticks = 0;
    let startedAt = 0; // when the animation began, for the seconds the tuning page shows next to the original hit time
    const tick = () => { ticks++; on?.landed?.(ticks, (performance.now() - startedAt) / 1000); on?.hit?.(ticks); };
    const land = () => { if (ticks === 0) tick(); };
    const mine = ++f.seq;
    const found = await skeletonFor(f, name, animeRes);
    if (generation !== token) return;
    if (!found && preview && !loop && animeRes !== undefined) throw new Error("缺少该技能动作素材");
    if (!found && !preview && f.ph && !loop && !f.dead) { // a placeholder lunges at the other side instead of an action; the lunge is its hit
      const x = f.body.position.x, d = f.group === 1 ? 40 : -40;
      await new Promise<void>(r => tween(f.body).to(0.15, { position: new Vec3(x + d, 0, 0) }).call(land).to(0.15, { position: new Vec3(x, 0, 0) }).call(() => r()).start());
      return;
    }
    if (!found || f.dead) { land(); return; }
    await showOnly(f, found.s);
    if (generation !== token) return;
    found.s.timeScale = (preview ? 1.2 : 1) * speedOf(f.model, found.anim); // 1.2: the original's battle_act_data.speed_scale_1; the factor is a hand correction
    f.body.setScale(Math.abs(f.body.scale.x) * f.side * (reverse ? -1 : 1), f.body.scale.y, 1);
    if (loop) { found.s.setAnimation(0, found.anim, true); return; }
    // the damage lands on the animation's hit event, or on its attack event when it has no hit (the area skills); it may run past 2 s (a
    // finishing move), so the wait for its end is its own length and a little more
    const json = found.s.skeletonData?.skeletonJson as { animations?: { [a: string]: { events?: { name: string; time?: number }[] } } } | undefined;
    const landOn = hitEvent((json?.animations?.[found.anim]?.events ?? []).map(e => e.name));
    // where the damage lands, in seconds of the animation; a hand correction (skilltune.ts) moves it, then it is timed here instead of by the event
    const landAt = (json?.animations?.[found.anim]?.events ?? []).filter(e => e.name.toLowerCase() === landOn).map(e => e.time ?? 0);
    on?.landTimes?.(landAt);
    const shift = hitShiftOf(f.model, found.anim);
    const timers: ReturnType<typeof setTimeout>[] = [];
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, (found.s.findAnimation(found.anim)?.duration ?? 2) / found.s.timeScale * 1000 + 500); // never wait for an animation forever
      if (shift !== 0) for (const t of landAt) timers.push(setTimeout(() => { if (generation === token) tick(); }, Math.max(0, t + shift) / found.s.timeScale * 1000));
      found.s.setEventListener((_entry, event) => {
        if (generation !== token) return;
        const n = event.data.name.toLowerCase();
        if (n === "attack") on?.attack?.(); // the original's attackPoint, whether or not the damage lands on this event too
        if (n === landOn) { if (shift === 0) tick(); }
        else if (n === "ready") on?.ready?.();
        else if (n === "move") on?.move?.();
        else if (n === "back") on?.back?.();
        else if (n === "shake_point") on?.shake?.();
      });
      found.s.setCompleteListener(() => { clearTimeout(timer); resolve(); });
      startedAt = performance.now();
      found.s.setAnimation(0, found.anim, false);
    });
    if (generation !== token) return;
    if (timers.length && ticks < timers.length) await wait(Math.max(0, ...landAt.map(t => t + shift)) / found.s.timeScale * 1000 - (found.s.findAnimation(found.anim)?.duration ?? 0) / found.s.timeScale * 1000 + 30); // a landing shifted past the animation's end still comes
    land();
    if (restorePose && !f.dead && f.seq === mine) await perform(f, "stand2", true); // a hurt that ends late must not cut off the attack that began after it
  };

  // a fighter whose model the release does not carry stands as a disc with its name, so the fight can still be followed
  const placeholder = (f: Fighter, name: string) => {
    const headPath = `icons/head/${f.bid}.webp`;
    if (preview && f.type === OBJECT_PARTNER && hasFile(headPath)) {
      const head = new Node("preview_portrait");
      head.layer = root.layer;
      head.addComponent(UITransform).setContentSize(104, 104);
      head.setPosition(0, 60, 0);
      const picture = head.addComponent(Sprite);
      picture.sizeMode = Sprite.SizeMode.CUSTOM;
      f.body.addChild(head);
      void spriteFrame(headPath).then(frame => { if (head.isValid) picture.spriteFrame = frame; }, () => {});
      f.ph = true;
      return;
    }
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
      const vitals = f?.vitals;
      if (!f || !vitals) continue;
      const info = buffTable[String(b.buff_bid)], action = Number(b.action_type);
      if (action === 2) vitals.buffs.delete(Number(b.id));
      else {
        if (action === 1 && info && !vitals.buffs.has(Number(b.id))) float(f, info[0], info[1] === 2 ? new Color(255, 110, 100, 255) : new Color(120, 255, 140, 255), false);
        vitals.buffs.set(Number(b.id), Number(b.buff_bid));
      }
      vitals.status.string = Array.from(new Set(Array.from(vitals.buffs.values()).map(bid => buffTable[String(bid)]?.[0]).filter(Boolean))).join(" ");
    }
  };

  const cellPos = (c: Cell) => new Vec3(c[0] * (W / 80), c[1] * (H / 80), 0);

  // the fighter runs to a cell: the original's moveTo / moveBack, an exponential ease out that starts after a delay
  const motions = new Map<Fighter, Set<{ done: Promise<void>; cancel(): void }>>();
  const recoil = new Map<Fighter, { done: Promise<void>; cancel(): void }>();
  const cancelMotion = (f: Fighter) => {
    for (const motion of motions.get(f) ?? []) motion.cancel();
  };
  const runTo = (f: Fighter, c: Cell, delay: number, time: number, replace = true): Promise<void> => {
    if (replace) cancelMotion(f);
    const active = motions.get(f) ?? new Set();
    motions.set(f, active);
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const movement = tween(f.root).delay(delay).to(time, { position: cellPos(c) }, { easing: "expoOut" });
    const finishMotion = () => {
      active.delete(entry);
      if (!active.size && motions.get(f) === active) motions.delete(f);
      finish();
    };
    const entry = { done, cancel() { movement.stop(); finishMotion(); } };
    active.add(entry);
    movement.call(finishMotion).start();
    return done;
  };
  const resetPreviewRound = () => {
    for (const f of fighters.values()) {
      cancelMotion(f);
      recoil.get(f)?.cancel();
      f.root.setPosition(cellPos(f.home));
      f.body.setScale(Math.abs(f.body.scale.x) * f.side, f.body.scale.y, 1);
      const opacity = f.body.getComponent(UIOpacity);
      if (opacity) { Tween.stopAllByTarget(opacity); opacity.opacity = 255; }
    }
  };

  // BattleModel.playBattleRoleHurt schedules SkillAct.hurt on the next frame.
  // Move the renderer root so attached hit effects travel with the target.
  const previewHurt = (f: Fighter): Promise<void> => {
    const current = recoil.get(f);
    if (current) return current.done;
    const base = f.root.position.clone();
    let finishMotion!: () => void;
    let finishAnimation!: (animation?: Promise<void>) => void;
    const motionDone = new Promise<void>(resolve => { finishMotion = resolve; });
    const animationDone = new Promise<void>(resolve => { finishAnimation = resolve; });
    const done = Promise.all([motionDone, animationDone]).then(() => {});
    const movement = tween(f.root)
      .to(0.02, { position: base.clone().add3f(-18 * f.side, 0, 0) })
      .delay(0.2)
      .to(0.05, { position: base });
    const start = () => {
      finishAnimation(perform(f, "hurt", false));
      movement.start();
    };
    recoil.set(f, { done, cancel() {
      director.off(Director.EVENT_BEFORE_UPDATE, start);
      movement.stop();
      f.root.setPosition(base);
      recoil.delete(f);
      finishAnimation();
      finishMotion();
    } });
    movement.call(() => { recoil.delete(f); finishMotion(); });
    director.once(Director.EVENT_BEFORE_UPDATE, start);
    return done;
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
    const mine = token;
    const name = fx.nm?.[String(skillBid)] ?? skillNames?.k[String(skillBid)]?.[0];
    if (f.type !== OBJECT_PARTNER || !name || (fx.n ?? []).indexOf(skillBid) >= 0 || !hasFile(`icons/head/${f.bid}.webp`)) return;
    if (lastBanner.get(f) === skillBid) return;
    lastBanner.set(f, skillBid);
    try {
      const frame = await spriteFrame(`icons/head/${f.bid}.webp`);
      if (mine !== token) return;
      headSprite.spriteFrame = frame;
    } catch { return; }
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
    if (mine !== token) return;
    if (s?.isValid) { s.node.active = true; s.setAnimation(0, f.group === 1 ? "action2" : "action1", false); }
    await wait(300);
    if (mine !== token) return;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { board.active = false; }, 500);
  };

  let hidden: Fighter[] = []; // the fighters a black screen keeps out of sight until it ends
  const blackOn = (alpha: number, others: Fighter[]) => {
    blackG.clear();
    blackG.fillColor = new Color(0, 0, 0, alpha);
    if (preview) blackG.rect(-W / 2, -H / 2, W * 2, H * 2);
    else blackG.rect(-100, -100, W + 200, H + 200);
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
    const vitals = f?.vitals;
    if (!f || !vitals) return;
    if (Number(e.is_hit) === 0) { if (k === 1) dodge(f); return; }
    const noHurt = effectInfo(fx, Number(e.effect_bid))?.noHurt ?? false; // the effect row says whether the target is shown hurt
    const change = Number(e.hp_changed);
    const share = hitShare(change, n);
    vitals.hp = last ? Math.max(0, Number(e.hp)) : Math.max(1, vitals.hp + share); // after the last hit it is the server's, so rounding in the parts leaves no drift
    drawBar(f, vitals);
    if (change < 0) {
      float(f, String(-share), e.is_crit ? new Color(255, 200, 40, 255) : new Color(255, 255, 255, 255), Boolean(e.is_crit));
      if (last && (Number(e.is_dead) === 1 || vitals.hp === 0)) {
        await perform(f, "hurt", false);
        f.dead = true;
        f.root.active = false;
      } else if (k === 1 && !noHurt) void perform(f, "hurt", false);
    } else if (change > 0) float(f, `+${share}`, new Color(90, 255, 120, 255), false);
  };

  const clearPreview = () => {
    resetPreviewRound();
    motions.clear();
    for (const layer of [roles, fxBelow, fxAbove, top, roundNode]) {
      for (const child of layer.children.slice()) {
        if (child === board) continue;
        child.removeFromParent();
        child.destroy();
      }
    }
    fighters.clear();
    lastBanner.clear();
    clearTimeout(bannerTimer);
    board.active = false;
    blackOff();
  };
  let previewCastToken = 0;

  return {
    root,
    show(on) { root.active = on; },
    stop() {
      token++;
      root.active = false;
      if (preview) clearPreview();
      else for (const f of fighters.values()) cancelMotion(f);
    },
    onTap(f) { tapped = f; },
    get lastCast() { return lastCast; },
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
      if (preview) clearPreview();
      else {
        for (const f of fighters.values()) cancelMotion(f);
        roles.removeAllChildren();
        top.removeAllChildren();
        roundNode.removeAllChildren();
        fighters.clear();
        blackOff();
        board.active = false;
        lastBanner.clear();
      }
      await Promise.all([picture(far, `bg/battle/${mapId}/m_bg.webp`), picture(ground, `bg/battle/${mapId}/map_bg.webp`)]);
      if (mine !== token) return;
      const poses: Promise<void>[] = [];
      for (const o of opening.objects as Msg[]) {
        const type = Number(o.object_type), group = Number(o.group), bid = Number(o.object_bid);
        const model = type === OBJECT_PARTNER ? models.p[`${bid}_${o.star}`] : type === OBJECT_UNIT ? models.u[String(bid)]?.[0] : undefined;
        const [gx, gy] = (preview ? previewCell(Number(o.pos)) : undefined) ?? cell(group, Number(o.pos)); // the preview stands its fighters as previewCell has it
        const unitSize = type === OBJECT_UNIT ? (models.u[String(bid)]?.[1] ?? 1000) / 1000 : 1;
        const size = unitSize * (preview ? (fx.ms?.[model ?? ""] ?? 1000) / 1000 : 1);
        const fr = new Node(`fighter_${o.pos}`);
        fr.layer = root.layer;
        fr.addComponent(UITransform);
        fr.setPosition(gx * (W / 80), gy * (H / 80), 0);
        const body = new Node("body");
        body.layer = root.layer;
        body.addComponent(UITransform);
        body.setScale(group === 1 ? size : -size, size, 1); // the second group faces the first
        fr.addChild(body);
        let vitals: BattleVitals | null = null;
        if (!preview) {
          const barNode = new Node("bar");
          barNode.layer = root.layer;
          barNode.addComponent(UITransform);
          barNode.setPosition(0, 130, 0);
          fr.addChild(barNode);
          vitals = { hp: Number(o.hp), hpMax: Math.max(1, Number(o.hp_max)), bar: barNode.addComponent(Graphics), buffs: new Map(), status: statusLabel(fr) };
        }
        const f: Fighter = { group, type, bid, model: model ?? "", ph: false, seq: 0, zOrder: preview ? previewZOrder(Number(o.pos), true) : 0, home: [gx, gy], side: group === 1 ? 1 : -1, row: Math.max(1, Math.min(3, Math.round((gy - 9) / 6))), root: fr, body, vitals, dead: false, files: new Map() };
        if (vitals) drawBar(f, vitals);
        fighters.set(Number(o.pos), f);
        roles.addChild(fr);
        if (!model) placeholder(f, String(o.object_name || bid));
        else if (preview) {
          poses.push((async () => {
            const found = await skeletonFor(f, "stand2");
            if (mine !== token) return;
            if (!found) placeholder(f, String(o.object_name || bid));
            else {
              found.s.node.active = true;
              found.s.setAnimation(0, found.anim, true);
            }
          })());
        }
        else {
          // a model the release does not carry (its stand file will not load) is replaced by the placeholder
          void skeletonFor(f, "stand2").then(found => { if (!found && mine === token && !f.dead) placeholder(f, String(o.object_name || bid)); });
          void perform(f, "stand2", true);
        }
      }
      if (preview) {
        // Original BattleRoleZorder for the formation slots.
        sortPreviewRoles();
        await Promise.all(poses);
      }
    },
    // the attacks of a round in their order: the attacker plays its action, runs to the first enemy it hits on the animation's move event and back on
    // its back event, the screen shakes on shake_point, and the hits land on its hit events, one part of an effect's split damage at each (parts the
    // animation has no event for land together when it ends, so the total always lands)
    async play(plays) {
      const mine = token;
      const reactions: Promise<void>[] = [];
      if (preview) {
        resetPreviewRound();
        lastBanner.clear(); // Each tap starts a new cast, with one banner for all its phases.
      }
      try {
      for (const p of [...plays].sort((a, b) => Number(a.order) - Number(b.order))) {
        if (mine !== token) return;
        const actorPos = Number(p.actor);
        const actor = fighters.get(actorPos);
        if (!actor || actor.dead) continue;
        if (preview) {
          for (const layer of [fxAbove, fxBelow, ...Array.from(fighters.values(), f => f.root)]) {
            for (const effect of layer.children.filter(child => child.name.startsWith("fx_"))) {
              effect.removeFromParent();
              effect.destroy();
            }
          }
        }
        const cast = ++previewCastToken;
        const effects = p.effect_play as Msg[];
        const attackBids = effects.map(e => Number(e.effect_bid)).filter(id => !preview || fx.am?.[String(id)] !== "none");
        const attack = attackOf(fx, Number(p.skill_bid), attackBids);
        const victim = effects.map(e => fighters.get(Number(e.target))).find(t => t && t.group !== actor.group);
        await showSkillName(actor, Number(p.skill_bid));
        if (mine !== token) return;
        const basePlan: MovePlan = movePlan(fx, actor.model, attack.animeRes, attack.anim);
        const plan: MovePlan = applyMove(basePlan, actor.model, attack.anim);
        lastCast = { landed: [], hits: [], model: actor.model, anim: attack.anim, animeRes: attack.animeRes, base: basePlan, skill: Number(p.skill_bid), entities: [] };
        const movementTargets = effects.map(e => fighters.get(Number(e.target))).filter((f): f is Fighter => !!f);
        const movementTarget = movementTargets.find(f => f.side !== actor.side) ?? movementTargets[movementTargets.length - 1] ?? actor;
        const firstPosition = Math.min(...effects.map(e => Number(e.target)));
        const targetSlot = firstPosition > 9 ? firstPosition - 9 : firstPosition;
        if (preview) {
          // BattleModel.initOrder restores the caster and the normalized target slot.
          resetPreviewZOrder(actor, actorPos);
          const firstTarget = fighters.get(targetSlot);
          if (firstTarget) resetPreviewZOrder(firstTarget, targetSlot);
        }
        const targetRow = Number.isFinite(targetSlot) ? (targetSlot - 1) % 3 + 1 : actor.row;
        const shakeId = effects.map(e => effectInfo(fx, Number(e.effect_bid))?.shakeId ?? 0).find(id => id !== 0) ?? 0;
        const parts = preview ? [] : effects.map(e => ({ e, n: effectInfo(fx, Number(e.effect_bid))?.splitHurt ?? 1, done: 0 }));
        const pending: Promise<void>[] = [];
        // the skill's effect models: the lists of its effect rows play at the animation's ready, attack (with the scene's area effects) and first hit
        const spot = (f: Fighter): FxSpot => ({ root: f.root, side: f.side, height: 150 });
        const bids = effects.map(e => Number(e.effect_bid));
        if (fxRes && lastCast) lastCast.entities = Array.from(new Set([0, 1, 2, 3, 4, 5].reduce<number[]>((all, list) => all.concat(entitiesOf(fxRes, bids, list)), [])));
        const targets = effects.map(e => fighters.get(Number(e.target))).filter((t): t is Fighter => !!t && t.group !== actor.group);
        const isCurrent = preview ? () => mine === token && cast === previewCastToken : undefined;
        const layers = { above: fxAbove, below: fxBelow };
        const playFx = (list: number, onTargets: boolean) => {
          if (!fxRes || mine !== token) return;
          if (preview && onTargets) {
            const seen = new Map<Fighter, Set<number>>();
            for (const effect of effects) {
              const target = fighters.get(Number(effect.target));
              if (!target) continue;
              const ids = seen.get(target) ?? new Set<number>();
              seen.set(target, ids);
              for (const id of entitiesOf(fxRes, [Number(effect.effect_bid)], list)) {
                if (ids.has(id)) continue;
                ids.add(id);
                playEntity(fxRes, id, list, spot(actor), spot(target), layers, isCurrent);
              }
            }
            return;
          }
          for (const id of entitiesOf(fxRes, bids, list)) {
            if (onTargets) for (const t of new Set(targets)) playEntity(fxRes, id, list, spot(actor), spot(t), layers);
            else playEntity(fxRes, id, list, spot(actor), victim ? spot(victim) : undefined, layers, isCurrent);
          }
        };
        // the skill's black screen: from its delay until the attacker is done
        const black = blackOf(fx, bids);
        let blackTimer: ReturnType<typeof setTimeout> | undefined;
        if (black) {
          const others = black.hideOthers ? Array.from(fighters.values()).filter(o => o !== actor && !o.dead && targets.indexOf(o) < 0) : [];
          blackTimer = setTimeout(() => { if (mine === token) blackOn(black.alpha, others); }, black.delay * 1000);
        }
        let hitFx = false, readyFx = false, attackFx = false;
        const ready = () => {
          if (preview && readyFx) return;
          readyFx = true;
          playFx(FxList.ready, false);
        };
        const release = () => {
          if (preview && attackFx) return;
          attackFx = true;
          playFx(FxList.attack, false);
          playFx(FxList.area, false);
        };
        const land = () => {
          if (mine !== token) return;
          if (preview) {
            const reacting = new Set<Fighter>();
            for (const effect of effects) {
              const target = fighters.get(Number(effect.target));
              const info = effectInfo(fx, Number(effect.effect_bid));
              if (target && !target.ph && target.group !== actor.group && info && !info.noHurt) reacting.add(target);
            }
            for (const target of reacting) reactions.push(previewHurt(target));
          }
          if (!hitFx) {
            hitFx = true;
            if (preview) {
              ready();
              release();
            }
            playFx(FxList.hit, true);
          }
          for (const part of parts) if (part.done < part.n) pending.push(hit(part.e, ++part.done, part.n));
        };
        const hooks: Hooks = {
          hit: land, ready, attack: release, landTimes: times => { if (lastCast) lastCast.hits = times; }, landed: (k, seconds) => { if (lastCast) lastCast.landed[k - 1] = seconds; },
          move: () => {
            if (actor.ph) return;
            if (!preview) actor.root.setSiblingIndex(roles.children.length);
            void runTo(actor, moveTarget(plan, actor.side, actor.home, movementTarget.home, targetRow, W / 80), plan.delay, plan.time);
          },
          back: () => {
            if (!actor.ph) void runTo(actor, backTarget(plan, actor.side, actor.home, movementTarget.home), plan.backDelay, plan.backTime);
          },
          shake: () => {
            if (!shakeId) return;
            const shaking = shake(shakeId);
            if (preview) pending.push(shaking);
          },
        };
        const scripted = preview ? bids.map(id => fx.script?.[String(id)]).find(Boolean) : undefined;
        const restorePose = !preview || !bids.some(id => fx.ps?.[String(id)] === 0);
        const animated = !preview || bids.some(id => fx.am?.[String(id)] !== "none" && !!effectInfo(fx, id)?.anim);
        try {
          let attackFinished: Promise<void> | undefined;
          if (scripted) {
            for (const group of scripted) {
              await Promise.all(group.map(async action => {
                const args = action.args;
                const delay = Number(args[0] ?? 0) / 30;
                await wait(delay * 1000);
                if (mine !== token) return;
                if (action.op === "attack") {
                  await perform(actor, attack.anim, false, hooks, attack.animeRes, Number(args[3]) === 1, restorePose);
                } else if (action.op === "fadeOut" || action.op === "fadeIn") {
                  const opacity = actor.body.getComponent(UIOpacity) ?? actor.body.addComponent(UIOpacity);
                  Tween.stopAllByTarget(opacity);
                  tween(opacity).to(Number(args[1]) * 2 / 60, { opacity: action.op === "fadeOut" ? 0 : 255 }).start();
                } else {
                  const scriptedPlan: MovePlan = { ...plan, area: false, col: Number(args[10]) === 1,
                    reverse: Number(args[9]) === 1, x: Number(args[2]), y: Number(args[3]) || 0, backX: Number(args[2]) };
                  const dest = action.op === "moveBack"
                    ? backTarget(scriptedPlan, actor.side, actor.home, movementTarget.home)
                    : moveTarget(scriptedPlan, actor.side, actor.home, movementTarget.home, targetRow, W / 80);
                  await runTo(actor, dest, 0, Number(args[1]) / 60, false);
                }
              }));
              if (mine !== token) return;
            }
          } else if (animated) {
            await perform(actor, attack.anim, false, hooks, attack.animeRes, false, restorePose);
            if (preview && mine === token) attackFinished = wait(100); // SkillAct's delayed actFinish.
          } else {
            ready(); release(); land();
          }
          await Promise.all([attackFinished, ...Array.from(motions.get(actor) ?? [], m => m.done)]);
        } finally {
          clearTimeout(blackTimer);
          if (mine === token && black) blackOff();
        }
        if (mine !== token) { clearTimeout(blackTimer); return; }
        while (parts.some(part => part.done < part.n)) land();
        await Promise.all(pending);
        if (mine !== token) { clearTimeout(blackTimer); return; }
        if (black) { clearTimeout(blackTimer); blackOff(); }
        if (!preview) await settle(actor);
        if (!preview) await wait(200);
      }
      await Promise.all(reactions);
      } finally {
        if (preview && mine === token) {
          resetPreviewRound();
          await Promise.all(Array.from(fighters.values(), f => perform(f, "stand2", true)));
        }
      }
    },
  };
}

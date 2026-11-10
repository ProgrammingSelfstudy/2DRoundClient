// The skill preview: from the hero info window (the library's, or a hero of yours) the battle scene stands the hero against a dummy and a row of
// buttons, one for each skill the hero has in slot order, casts it through the scene's own play(), so what it shows is what a fight shows. A passive
// has no cast animation in the client's tables, so its name and text show over the field. "返回" closes it. The same cast as ?skillbtn= (skilldemo.ts),
// with buttons of the game instead of the page's.
import { Color, Graphics, HorizontalTextAlignment, Label, Node, UITransform, VerticalTextAlignment } from "cc";
import { loadJson } from "./cdn";
import { W, H, chapterMap } from "./design";
import { attackOf, effectInfo, hitsSelf } from "./skillplan";
import type { Fx } from "./skillplan";
import type { BattleScene } from "./battlescene";
import type { Msg } from "./shared/proto/codec";

interface HeroSkills { k: { [skill: string]: [string, number[]] }; a?: { [skill: string]: [string, number[]] } } // k: the heroes' active skills; a: every skill row with effects, whoever has it // hero_skills.json: skill -> name, effect bids
interface SkillInfo { h: { [heroStar: string]: number[] }; k: { [skill: string]: [string, string, string, number, string] } } // name, text, icon, passive, note

const MINE = 2, THEIRS = 11; // positions: my front middle and the enemy's first, in the same row (the grid of battlescene.ts)
const HP = 1e9;
const BTN_W = 200, BTN_H = 58, GAP = 12, COLS = 3;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface SkillPreview { root: Node; open(bid: number, star: number): Promise<void>; close(): void }

export async function buildSkillPreview(parent: Node, scene: BattleScene, afterClose: () => void): Promise<SkillPreview> {
  const [fx, table, info] = await Promise.all([loadJson<Fx>("tables/skill_fx.json"), loadJson<HeroSkills>("tables/hero_skills.json"), loadJson<SkillInfo>("tables/hero_skill_info.json")]);
  const root = new Node("skill_preview");
  root.layer = parent.layer;
  const rt = root.addComponent(UITransform);
  rt.setContentSize(W, H);
  rt.setAnchorPoint(0, 0);
  root.setPosition(-W / 2, -H / 2, 0);
  root.active = false;
  parent.addChild(root);

  const label = (p: Node, text: string, size: number, w: number, h: number) => {
    const n = new Node("text");
    n.layer = root.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.SHRINK;
    l.enableWrapText = false; // a long name shrinks on its one line
    l.color = new Color(255, 255, 255, 255);
    l.enableOutline = true;
    l.outlineColor = new Color(40, 20, 10, 255);
    l.outlineWidth = 2;
    p.addChild(n);
    return n;
  };
  const button = (text: string, x: number, y: number, w: number, h: number, onTap: () => void) => {
    const b = new Node("button");
    b.layer = root.layer;
    b.addComponent(UITransform).setContentSize(w, h);
    b.setPosition(x, y, 0);
    const g = b.addComponent(Graphics);
    g.fillColor = new Color(74, 51, 34, 235);
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.fill();
    g.strokeColor = new Color(248, 194, 60, 255);
    g.lineWidth = 3;
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.stroke();
    label(b, text, 26, w - 16, h);
    b.on(Node.EventType.TOUCH_END, onTap);
    root.addChild(b);
    return b;
  };

  let buttons: Node[] = [];
  let busy = false, token = 0;
  const close = () => {
    token++;
    root.active = false;
    root.removeAllChildren();
    buttons = [];
    scene.show(false);
    afterClose();
  };

  const cast = async (sid: number, mine: number) => {
    if (busy) return;
    busy = true;
    try {
      const row = table.a?.[String(sid)] ?? table.k[String(sid)]; // by the skill's own row, not by what a hero lists
      const [name, text] = info.k[String(sid)] ?? [row?.[0] ?? String(sid), ""];
      if (row) {
        const effects = row[1];
        scene.caption(`${name}  ${attackOf(fx, sid, effects).anim}`);
        await scene.play([{
          order: 1, actor: MINE, target: THEIRS, skill_bid: sid, talk_pos: 0, talk_content: "",
          effect_play: effects.map((effect_bid, i) => ({
            order: i + 1, actor: MINE, target: hitsSelf(fx, effect_bid) ? MINE : THEIRS, effect_bid, is_hit: 1, is_crit: 0, hp: HP, // by the effect row's own target, not by the skill
            hp_changed: effectInfo(fx, effect_bid)?.noHurt ? 0 : -1000, is_dead: 0, buff_list: [],
          })),
        }] as unknown as Msg[]);
      } else {
        scene.caption(`${name}（被动）${text.length > 18 ? text.slice(0, 18) + "…" : text}`); // the caption is one line
        await wait(4000);
      }
    } finally {
      if (mine === token) busy = false;
    }
  };

  return {
    root,
    async open(bid, star) {
      const mine = ++token;
      busy = false;
      root.removeAllChildren();
      let key = `${bid}_${star}`, st = star;
      while (!info.h[key] && st > 1) key = `${bid}_${--st}`; // the highest star of the hero the table has at or below this one
      const ids = info.h[key] ?? [];
      await scene.start({
        objects: [
          { object_type: 2, group: 1, pos: MINE, object_bid: bid, star, object_name: key, hp: HP, hp_max: HP },
          { object_type: 3, group: 2, pos: THEIRS, object_bid: 101011, star: 1, object_name: "木桩", hp: HP, hp_max: HP },
        ],
      } as unknown as Msg, chapterMap(1));
      if (mine !== token) return;
      scene.show(true);
      scene.onTap(() => {}); // a tap on the field is not "back" here
      scene.caption(ids.length ? "点技能按钮预览" : "暂无技能资料");
      root.active = true;
      // the skill buttons: rows of three from the bottom up over the tabs (the bottom 230 are the tabs and the back button)
      ids.forEach((id, i) => {
        const col = i % COLS, rowFromTop = Math.floor(i / COLS), rows = Math.ceil(ids.length / COLS);
        const x = W / 2 + (col - (Math.min(COLS, ids.length - rowFromTop * COLS) - 1) / 2) * (BTN_W + GAP);
        const y = 250 + (rows - 1 - rowFromTop) * (BTN_H + GAP);
        const name = info.k[String(id)][0];
        buttons.push(button(info.k[String(id)][3] ? `${name}（被动）` : name, x, y, BTN_W, BTN_H, () => { void cast(id, mine); }));
      });
      button("返回", 110, 170, 160, BTN_H, close);
    },
    close,
  };
}

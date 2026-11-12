// Skill playback from the hero bag or compendium. The preview has its own scene and uses skill rows directly.
import { Color, Graphics, HorizontalTextAlignment, Label, Mask, Node, UIOpacity, UITransform, VerticalTextAlignment } from "cc";
import { buildBattleScene } from "./battlescene";
import { loadJson } from "./cdn";
import { W, H, chapterMap } from "./design";
import type { PartnerTable } from "./herocell";
import type { OperationLog } from "./operationlog";
import { PREVIEW_ACTOR, previewCasts, previewOpening } from "./skillplan";
import type { Fx } from "./skillplan";
import { opaqueBase } from "./ui";
import { dragScroll } from "./widgets";

interface HeroSkills {
  h: { [heroStar: string]: [string, number[]] };
  k: { [skill: string]: [string, number[]] };
  a?: { [skill: string]: [string, number[]] };
}
interface SkillInfo {
  h: { [heroStar: string]: number[] };
  k: { [skill: string]: [string, string, string, number, string] };
}
interface Skill {
  id: number;
  name: string;
  description: string;
  passive: boolean;
  effects: number[];
}

const BTN_W = 300, BTN_H = 84, GAP = 14;
const INK = new Color(255, 240, 213, 255);
const GOLD = new Color(224, 174, 91, 255);
const PAPER = new Color(42, 27, 19, 250);
const BUTTON = new Color(85, 53, 33, 255);

export interface SkillPreview { root: Node; open(bid: number, star: number): Promise<void>; close(): void }

export async function buildSkillPreview(parent: Node, log?: OperationLog): Promise<SkillPreview> {
  const [fx, table, info, partners] = await Promise.all([
    loadJson<Fx>("tables/skill_fx.json"),
    loadJson<HeroSkills>("tables/hero_skills.json"),
    loadJson<SkillInfo>("tables/hero_skill_info.json"),
    loadJson<PartnerTable>("tables/partners.json"),
  ]);
  const root = new Node("skill_preview");
  root.layer = parent.layer;
  root.addComponent(UITransform).setContentSize(W, H);
  root.active = false;
  parent.addChild(root);

  const node = (parent: Node, name: string, x: number, y: number, w: number, h: number) => {
    const n = new Node(name);
    n.layer = root.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    parent.addChild(n);
    return n;
  };
  const base = node(root, "base_layer", -W / 2, -H / 2, W, H);
  opaqueBase(base, W, H);
  const scene = await buildBattleScene(root, "preview");
  const controls = node(root, "preview_controls", -W / 2, -H / 2, W, H);

  const label = (parent: Node, text: string, size: number, w: number, h: number, x = 0, y = 0) => {
    const n = node(parent, "text", x, y, w, h);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 7;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.CLAMP;
    l.enableWrapText = true;
    l.color = INK;
    return l;
  };
  const box = (parent: Node, name: string, x: number, y: number, w: number, h: number, fill: Color) => {
    const n = node(parent, name, x, y, w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = fill;
    g.strokeColor = GOLD;
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.fill();
    g.stroke();
    return n;
  };
  const button = (parent: Node, name: string, text: string, x: number, y: number, w: number, onTap: () => void) => {
    const n = box(parent, name, x, y, w, BTN_H, BUTTON);
    label(n, text, 26, w - 20, BTN_H - 6);
    n.on(Node.EventType.TOUCH_END, onTap);
    return n;
  };

  const header = box(controls, "preview_header", W / 2, H - 64, W - 44, 100, PAPER);
  const title = label(header, "", 27, 460, 86, -79);
  const status = label(controls, "", 27, W - 40, 44, W / 2, H - 141);
  status.enableOutline = true;
  status.outlineColor = PAPER;
  status.outlineWidth = 3;
  const content = node(controls, "preview_content", 0, 0, W, H);
  let token = 0, busy = false;

  const clear = (container: Node) => {
    for (const child of container.children.slice()) {
      child.removeFromParent();
      child.destroy();
    }
  };
  const close = () => {
    token++;
    busy = false;
    root.active = false;
    scene.stop();
    clear(content);
  };
  button(header, "preview_back", "返回", 242, 0, 142, close);

  const skillsOf = (bid: number, star: number): Skill[] => {
    let key = `${bid}_${star}`;
    while (!info.h[key] && !table.h[key] && star > 1) key = `${bid}_${--star}`;
    const ids = info.h[key] ?? table.h[key]?.[1] ?? [];
    const skills: Skill[] = [];
    for (const id of ids) {
      const meta = info.k[String(id)];
      const row = table.a?.[String(id)] ?? table.k[String(id)];
      const name = meta?.[0] ?? row?.[0];
      if (!name) continue;
      const passive = meta?.[3] === 1;
      skills.push({ id, name, description: meta?.[1] ?? "", passive, effects: passive ? [] : row?.[1] ?? [] });

      // The original sends the other rank of 亡者戏 as its own skill when Zoro is in Asura form.
      if (bid === 70501 && id >= 541301 && id <= 541305) {
        const variant = table.a?.[String(id + 10)];
        if (variant?.[1].length) skills.push({ id: id + 10, name: "亡者戏（阿修罗形态）", description: "", passive: false, effects: variant[1] });
      }
    }
    return skills;
  };

  const showDescription = (skill: Skill, grid: Node) => {
    grid.active = false;
    const panel = box(content, "preview_description", W / 2, 255, W - 44, 390, PAPER);
    label(panel, skill.name, 28, 600, 64, 0, 152);
    const viewport = node(panel, "description_view", 0, 20, 612, 194);
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
    const text = skill.description || "暂无技能说明";
    const body = label(viewport, text, 25, 596, Math.max(194, (Math.ceil(text.length / 21) + 2) * 33));
    const transform = body.node.getComponent(UITransform)!;
    transform.setAnchorPoint(0.5, 1);
    body.node.setPosition(0, 97, 0);
    body.horizontalAlign = HorizontalTextAlignment.LEFT;
    body.verticalAlign = VerticalTextAlignment.TOP;
    dragScroll(viewport, body.node, "y").range(97, 97 + transform.height - 194);
    button(panel, "preview_skill_list", "返回技能列表", 0, -142, 260, () => {
      panel.removeFromParent();
      panel.destroy();
      grid.active = true;
    });
  };

  const render = (skills: Skill[], generation: number) => {
    const rows = Math.ceil(skills.length / 2);
    const height = Math.max(106, rows * (BTN_H + GAP) + 18);
    const grid = box(content, "preview_skills", W / 2, 56 + height / 2, W - 44, height, PAPER);
    if (!skills.length) {
      label(grid, "暂无技能演示", 30, 600, 64);
      return;
    }
    const opacity = grid.addComponent(UIOpacity);
    skills.forEach((skill, i) => {
      const x = i === skills.length - 1 && i % 2 === 0 ? 0 : (i % 2 === 0 ? -1 : 1) * (BTN_W + GAP) / 2;
      const y = height / 2 - 16 - BTN_H / 2 - Math.floor(i / 2) * (BTN_H + GAP);
      const name = skill.passive ? `${skill.name}（被动）` : skill.name;
      button(grid, `preview_skill_${skill.id}`, name, x, y, BTN_W, () => {
        if (busy) return;
        log?.record("skill", skill.id);
        if (!skill.effects.length) { showDescription(skill, grid); return; }
        busy = true;
        opacity.opacity = 215;
        status.string = `${skill.name} · 播放中`;
        void scene.play(previewCasts(fx, skill.id, skill.effects)).then(() => {
          if (generation === token) {
            status.string = skill.name;
            log?.record("skillPlayed", skill.id);
          }
        }, e => {
          console.warn("skill preview", skill.id, e);
          if (generation === token) {
            const missing = e instanceof Error && e.message === "缺少该技能动作素材";
            status.string = missing ? "缺少该技能动作素材" : "技能播放失败，可再试一次";
            log?.record(missing ? "skillMissing" : "skillFailed", skill.id);
          }
        }).finally(() => {
          if (generation !== token) return;
          busy = false;
          opacity.opacity = 255;
        });
      });
    });
  };

  return {
    root,
    async open(bid, star) {
      log?.record("preview", bid);
      const generation = ++token;
      busy = false;
      scene.stop();
      clear(content);
      const name = partners.base[String(bid)]?.[0] ?? String(bid);
      const skills = skillsOf(bid, star);
      title.string = `${name} · 技能预览`;
      status.string = "正在加载预览";
      root.active = true;
      try {
        await scene.start(previewOpening(fx, bid, star, name, skills.map(skill => skill.effects)), chapterMap(1));
        if (generation !== token) return;
        scene.show(true);
        status.string = scene.isPlaceholder(PREVIEW_ACTOR) ? "暂无可用模型" : "";
        render(skills, generation);
      } catch (e) {
        if (generation !== token) return;
        console.warn("skill preview", bid, e);
        log?.record("previewFailed", bid);
        status.string = "预览加载失败，请返回后重试";
      }
    },
    close,
  };
}

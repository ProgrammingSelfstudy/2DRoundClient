// The hero info window: the original `hero/hero_main_info_window` (HeroMainInfoWindow). Opened by tapping a cell of the hero list. Shows the
// window's own background, the hero's model (Spine, when the release carries it), name, camp, stars and power, and the attribute list the
// server sends in 11063 in the tab area. The other tabs (skill, equipment, talent) have no page yet.
import { Color, HorizontalTextAlignment, Label, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { W, H } from "./loginpage";
import { spineNode } from "./spine";

export interface HeroInfo { partner_id: number; bid: number; lev: number; star: number; power: number }
type Attrs = { [key: string]: unknown };
interface PartnerTable { base: { [bid: string]: [string, number, number] }; head: { [key: string]: number } }
interface Models { p: { [key: string]: string } }

const COMMON = "ui/common/common.json";
const CAMP: { [camp: number]: string } = { 1: "common_90067", 2: "common_90068", 3: "common_90069", 4: "common_90070", 5: "common_90079", 7: "common_900072" };
// the 11063 fields in the order the list shows them
const ATTRS: [string, string][] = [
  ["hp", "生命"], ["atk", "攻击"], ["def_p", "物防"], ["def_s", "魔防"], ["speed", "速度"], ["hit_rate", "命中"], ["dodge_rate", "闪避"],
  ["crit_rate", "暴击"], ["crit_ratio", "暴伤"], ["hit_magic", "效果命中"], ["dodge_magic", "效果抵抗"], ["dam", "增伤"], ["res", "减伤"],
  ["cure", "治疗"], ["be_cure", "受疗"], ["tenacity", "韧性"],
];

export interface HeroDetail { root: Node; open(h: HeroInfo, attrs: Attrs | null): void; setAttrs(partnerId: number, attrs: Attrs): void; close(): void; onClose(f: () => void): void }

export async function buildHeroDetail(canvas: Node): Promise<HeroDetail> {
  const [win, table, models] = await Promise.all([
    loadJson<LNode>("layouts/hero/hero_main_info_window.json"),
    loadJson<PartnerTable>("tables/partners.json"),
    loadJson<Models>("tables/battle_models.json"),
  ]);
  const built = await buildLayout(win, canvas, {
    // camp backdrop, resonance timer, side buttons, skin button, hero switch arrows and the voice area are driven by features not built yet
    hide: ["hero_camp_bg", "resonate_panel", "comment_btn", "lock_btn", "share_btn", "reset_btn", "skin_btn", "left_btn", "right_btn", "voice_panel", "power_click"],
  });
  const root = built.root;
  root.setPosition(-W / 2, -H / 2, 0);
  opaqueBase(root, W, H);
  root.active = false;
  const node = (name: string) => built.byName.get(name)!;

  // the layout's background is a placeholder; the window loads bigbg/hero/hero_info_bg_def into it (HeroMainInfoWindow.updateBackground)
  const bg = node("background");
  const bgSprite = bg.getComponent(Sprite) ?? bg.addComponent(Sprite);
  bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
  spriteFrame("bg/hero/hero_info_bg_def.webp").then(sf => { if (bgSprite.isValid) bgSprite.spriteFrame = sf; }, e => console.warn("hero info background:", e));
  bg.getComponent(UITransform)!.setContentSize(W, H);

  const tabs = ["属性", "技能", "装备", "天赋"];
  tabs.forEach((title, i) => {
    const btn = node("tab_btn").getChildByName(`tab_btn_${i + 1}`)!;
    const label = btn.getChildByName("label")!.getComponent(Label)!;
    label.string = title;
    btn.getChildByName("select_img")!.active = i === 0;
    btn.getChildByName("normal_img")!.active = i !== 0;
    btn.getChildByName("red_point")!.active = false;
  });

  const label = (parent: Node, text: string, x: number, y: number, align: HorizontalTextAlignment, size = 24) => {
    const n = new Node("text");
    n.layer = parent.layer;
    n.addComponent(UITransform).setContentSize(300, 32);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.horizontalAlign = align;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    l.overflow = Label.Overflow.NONE;
    l.color = new Color(255, 255, 255, 255);
    l.enableOutline = true;
    l.outlineColor = new Color(40, 20, 10, 255);
    l.outlineWidth = 2;
    parent.addChild(n);
    return l;
  };

  const lay = node("lay_hero");
  const modelNode = node("mode_node");
  const starNode = node("star_node");
  const campIcon = node("camp_icon").getComponent(Sprite)!;
  const nameLabel = node("name").getComponent(Label)!;
  const powerLabel = label(lay, "", 0, 334, HorizontalTextAlignment.CENTER, 28); // where power_click sat
  const container = node("tab_container");
  const list = new Node("attrs");
  list.layer = container.layer;
  list.addComponent(UITransform).setContentSize(680, 360);
  container.addChild(list);

  let current = 0, closeFn = () => {};
  let levelLabel: Label | null = null;

  const drawAttrs = (attrs: Attrs | null) => {
    list.removeAllChildren();
    // two columns of name / value, filled top to bottom
    ATTRS.forEach(([key, title], i) => {
      const col = Math.floor(i / 8), row = i % 8;
      const x = -170 + col * 340, y = 150 - row * 42;
      label(list, title, x - 60, y, HorizontalTextAlignment.LEFT);
      label(list, attrs && attrs[key] !== undefined ? String(attrs[key]) : "-", x + 90, y, HorizontalTextAlignment.RIGHT);
    });
  };

  const close = () => { root.active = false; closeFn(); };
  node("close_btn").on(Node.EventType.TOUCH_END, close);

  return {
    root,
    open(h, attrs) {
      current = h.partner_id;
      const base = table.base[String(h.bid)];
      nameLabel.string = base?.[0] ?? String(h.bid);
      powerLabel.string = `战力 ${h.power}`;
      atlasFrame(COMMON, `${CAMP[base?.[1] ?? 0] ?? "common_90071"}.png`).then(sf => { if (campIcon.isValid) campIcon.spriteFrame = sf; }, () => {});
      // stars: 5 along a row, 30 apart, centred on star_node
      starNode.removeAllChildren();
      const n = Math.min(5, Math.max(1, h.star));
      for (let i = 0; i < n; i++) {
        const s = new Node("star");
        s.layer = starNode.layer;
        s.addComponent(UITransform).setContentSize(28, 28);
        s.setPosition((i - (n - 1) / 2) * 30, 0, 0);
        const sp = s.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        atlasFrame(COMMON, "common_90074.png").then(sf => { if (sp.isValid) sp.spriteFrame = sf; }, () => {});
        starNode.addChild(s);
      }
      levelLabel?.node.destroy();
      levelLabel = label(lay, `Lv.${h.lev}`, 0, 365, HorizontalTextAlignment.CENTER);
      // the model: only the heroes whose Spine the release carries show one
      modelNode.removeAllChildren();
      const model = models.p[`${h.bid}_${h.star}`];
      if (model) spineNode(`spine/hero/${model}/stand2`, "stand2", modelNode).catch(e => console.warn(`hero info ${model}:`, (e as Error).message));
      drawAttrs(attrs);
      root.active = true;
    },
    setAttrs(partnerId, attrs) { if (partnerId === current) drawAttrs(attrs); },
    close,
    onClose(f) { closeFn = f; },
  };
}

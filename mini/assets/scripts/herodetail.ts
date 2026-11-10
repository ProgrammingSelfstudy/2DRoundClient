// The hero info window: the original `hero/hero_main_info_window` (HeroMainInfoWindow). Opened by tapping a cell of the hero list. Shows the
// window's own background, the hero's model (Spine, when the release carries it), name, camp, stars and power, and the attribute list the
// server sends in 11063 in the tab area, or the hero's skills (name, picture, text) from the client's own table. The other tabs (equipment, talent)
// have no page yet.
import { Color, Graphics, HorizontalTextAlignment, Label, Mask, Node, Sprite, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, hasFile, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";
import { spineNode } from "./spine";

export interface HeroInfo { partner_id: number; bid: number; lev: number; star: number; power: number }
type Attrs = { [key: string]: unknown };
interface PartnerTable { base: { [bid: string]: [string, number, number] }; head: { [key: string]: number } }
interface Models { p: { [key: string]: string } }
// hero_skill_info.json: the skills of a hero star in slot order, and per skill: name, text, picture, passive (0 or 1), note on how it opens
interface SkillInfo { h: { [heroStar: string]: number[] }; k: { [skill: string]: [string, string, string, number, string] } }

const COMMON = "ui/common/common.json";
const CAMP: { [camp: number]: string } = { 1: "common_90067", 2: "common_90068", 3: "common_90069", 4: "common_90070", 5: "common_90079", 7: "common_900072" };
// the 11063 fields as the original's attribute panel lists them (HeroTipsAttrPanel key lists; names from Config.AttrData.data_key_to_name), two to a row
const ATTRS: [string, string][] = [
  ["atk", "攻击"], ["hp", "生命"], ["def", "防御"], ["speed", "速度"],
  ["crit_rate", "暴击率"], ["crit_ratio", "暴伤"], ["hit_magic", "控制"], ["dodge_magic", "抗控"], ["tenacity", "抗暴"], ["hit_rate", "命中"],
  ["res", "免伤"], ["dodge_rate", "闪躲"], ["cure", "治疗"], ["be_cure", "受疗"], ["dam", "伤害加成"], ["dam_p", "物伤"], ["dam_s", "法伤"],
  ["res_p", "物免"], ["res_s", "法免"],
];

// the attributes the original shows as a percentage (Config.AttrData.data_type 2, HeroTipsAttrPanel.setData: the number is in tenths of a percent)
const PERCENT = new Set(["crit_rate", "crit_ratio", "hit_magic", "dodge_magic", "hit_rate", "dodge_rate", "dam", "res", "cure", "be_cure", "tenacity", "dam_p", "dam_s", "res_p", "res_s"]);
const shown = (key: string, v: number) => (PERCENT.has(key) ? `${v / 10}%` : String(v));

export interface HeroDetail { root: Node; open(h: HeroInfo, attrs: Attrs | null): void; setAttrs(partnerId: number, attrs: Attrs): void; close(): void; onClose(f: () => void): void }

export async function buildHeroDetail(canvas: Node): Promise<HeroDetail> {
  const [win, table, models, skills] = await Promise.all([
    loadJson<LNode>("layouts/hero/hero_main_info_window.json"),
    loadJson<PartnerTable>("tables/partners.json"),
    loadJson<Models>("tables/battle_models.json"),
    loadJson<SkillInfo>("tables/hero_skill_info.json").catch(() => null), // a release without it just has no skill page
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
    btn.on(Node.EventType.TOUCH_END, () => showTab(i));
  });
  let showTab = (_i: number) => {}; // set below, once the pages it switches between exist

  const label = (parent: Node, text: string, x: number, y: number, align: HorizontalTextAlignment, size = 24, width = 300) => {
    const n = new Node("text");
    n.layer = parent.layer;
    n.addComponent(UITransform).setContentSize(width, 32);
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
    // two columns of name / value, filled left to right
    ATTRS.forEach(([key, title], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = -170 + col * 340, y = 165 - row * 36;
      label(list, title, x - 60, y, HorizontalTextAlignment.LEFT);
      label(list, attrs && attrs[key] !== undefined ? shown(key, Number(attrs[key])) : "-", x + 90, y, HorizontalTextAlignment.RIGHT);
    });
  };

  // the skill page: a clipped viewport with one row per skill (picture, name, text), dragged up and down
  const skillView = new Node("skills");
  skillView.layer = container.layer;
  skillView.addComponent(UITransform).setContentSize(680, 360);
  skillView.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const skillContent = new Node("content");
  skillContent.layer = container.layer;
  skillContent.addComponent(UITransform).setAnchorPoint(0.5, 1);
  skillView.addChild(skillContent);
  container.addChild(skillView);
  const skillScroll = dragScroll(skillView, skillContent, "y");

  const drawSkills = (bid: number, star: number) => {
    skillContent.removeAllChildren();
    // the hero's own star, else the highest star of it the table has below that
    let key = `${bid}_${star}`;
    while (skills && !skills.h[key] && star > 1) key = `${bid}_${--star}`;
    const ids = skills?.h[key] ?? [];
    let y = 0;
    ids.forEach(id => {
      const [name, text, icon, passive, note] = skills!.k[String(id)];
      const lines = Math.max(1, Math.ceil(text.length / 24)); // about 24 characters of the 20 point text fit the 480 wide column
      const h = Math.max(92, 44 + lines * 24 + (note ? 24 : 0));
      const row = new Node("skill");
      row.layer = container.layer;
      row.addComponent(UITransform).setContentSize(680, h);
      row.setPosition(0, -y - h / 2, 0);
      const pic = new Node("icon");
      pic.layer = container.layer;
      pic.addComponent(UITransform).setContentSize(72, 72);
      pic.setPosition(-290, h / 2 - 46, 0);
      const sp = pic.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (hasFile(`icons/skill/${icon}.webp`)) spriteFrame(`icons/skill/${icon}.webp`).then(sf => { if (sp.isValid) sp.spriteFrame = sf; }, () => {});
      row.addChild(pic);
      // the column starts at x = -250; a label with no wrap is as wide as its text, so anchor it by its left edge
      const left = (l: Label, top: number) => { l.node.getComponent(UITransform)!.setAnchorPoint(0, top === 0 ? 0.5 : 1); l.node.setPosition(-250, h / 2 - (top || 22), 0); };
      left(label(row, name + (passive ? "（被动）" : ""), 0, 0, HorizontalTextAlignment.LEFT, 24, 480), 0);
      const body = label(row, text, 0, 0, HorizontalTextAlignment.LEFT, 20, 480);
      body.overflow = Label.Overflow.RESIZE_HEIGHT;
      body.lineHeight = 24;
      left(body, 40);
      if (note) {
        const n = label(row, note, 0, 0, HorizontalTextAlignment.LEFT, 18, 480);
        n.color = new Color(248, 194, 60, 255);
        left(n, 40 + lines * 24 + 4);
      }
      skillContent.addChild(row);
      y += h;
    });
    if (!ids.length) label(skillContent, "暂无技能资料", 0, -60, HorizontalTextAlignment.CENTER);
    skillContent.getComponent(UITransform)!.setContentSize(680, Math.max(360, y));
    skillScroll.range(180, 180 + Math.max(0, y - 360));
    skillContent.setPosition(0, 180, 0);
  };

  let curBid = 0, curStar = 1;
  showTab = (i: number) => {
    tabs.forEach((_, j) => {
      const b = node("tab_btn").getChildByName(`tab_btn_${j + 1}`)!;
      b.getChildByName("select_img")!.active = j === i;
      b.getChildByName("normal_img")!.active = j !== i;
    });
    list.active = i === 0;
    skillView.active = i === 1;
    if (i === 1) drawSkills(curBid, curStar);
  };

  // The original's page under the hero is the train panel (HeroMainTabTrainPanel): the level line, the four base attributes with a "?" that opens
  // the full list (HeroTipsAttrPanel) and the hero's skill icons; the tab buttons are hidden there until a feature shows them. Its layout is not
  // in the release (the original builds it in Lua), so the places come from a screenshot of the original, counted from the window's bottom.
  node("tab_btn").active = false;
  container.active = false;
  const popup = (w: number, h: number, inner: Node) => {
    const n = new Node("popup");
    n.layer = root.layer;
    n.addComponent(UITransform).setContentSize(W, H);
    n.setPosition(W / 2, H / 2, 0);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 170);
    g.rect(-W / 2, -H / 2, W, H);
    g.fill();
    g.fillColor = new Color(52, 40, 32, 245);
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.fill();
    inner.removeFromParent();
    inner.setPosition(0, 0, 0);
    inner.active = true;
    n.addChild(inner);
    n.active = false;
    n.on(Node.EventType.TOUCH_END, () => { n.active = false; });
    root.addChild(n);
    return n;
  };
  const attrPopup = popup(700, 400, list);
  const skillPopup = popup(700, 400, skillView);

  const train = new Node("train");
  train.layer = root.layer;
  train.addComponent(UITransform).setContentSize(W, H);
  root.addChild(train);
  const text = (s: string, x: number, y: number, size: number, color: Color, align = HorizontalTextAlignment.LEFT) => {
    const l = label(train, s, x, y, align, size, 200);
    l.color = color;
    l.node.getComponent(UITransform)!.setAnchorPoint(align === HorizontalTextAlignment.LEFT ? 0 : 0.5, 0.5);
    return l;
  };
  const GOLD = new Color(223, 204, 146, 255);
  text("进阶:", 31, 534, 26, GOLD);
  for (let i = 0; i < 5; i++) {
    const st = new Node("star");
    st.layer = root.layer;
    st.addComponent(UITransform).setContentSize(28, 28);
    st.setPosition(130 + i * 30, 534, 0);
    const sp = st.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.color = new Color(90, 80, 70, 255); // no break stage is modelled: all five stars dark
    atlasFrame(COMMON, "common_90074.png").then(sf => { if (sp.isValid) sp.spriteFrame = sf; }, () => {});
    train.addChild(st);
  }
  const levelText = text("", 31, 434, 26, GOLD);
  // base attributes: icon and value, as the train panel's attr_icon1..4 / attr_label1..4
  const BASE: [string, string, number][] = [["atk", "common_90021", 31], ["hp", "common_90022", 207], ["def", "common_90023", 382], ["speed", "common_90038", 515]];
  const baseText = BASE.map(([, frame, x]) => {
    const ic = new Node("attr_icon");
    ic.layer = root.layer;
    ic.addComponent(UITransform).setContentSize(40, 40);
    ic.setPosition(x + 20, 380, 0);
    const sp = ic.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    atlasFrame(COMMON, `${frame}.png`).then(sf => { if (sp.isValid) sp.spriteFrame = sf; }, () => {});
    train.addChild(ic);
    return text("", x + 50, 380, 26, new Color(255, 255, 255, 255));
  });
  const help = new Node("attr_help");
  help.layer = root.layer;
  help.addComponent(UITransform).setContentSize(48, 48);
  help.setPosition(665, 380, 0);
  const hg = help.addComponent(Graphics);
  hg.fillColor = new Color(70, 52, 34, 255);
  hg.circle(0, 0, 22);
  hg.fill();
  train.addChild(help);
  label(help, "?", 0, 0, HorizontalTextAlignment.CENTER, 30, 48);
  help.on(Node.EventType.TOUCH_END, () => { attrPopup.active = true; attrPopup.setSiblingIndex(root.children.length); });
  const skillIcons: Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const ic = new Node("skill_icon");
    ic.layer = root.layer;
    ic.addComponent(UITransform).setContentSize(94, 94);
    ic.setPosition(186 + i * 116, 292, 0);
    const sp = ic.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    ic.on(Node.EventType.TOUCH_END, () => { skillPopup.active = true; skillPopup.setSiblingIndex(root.children.length); });
    train.addChild(ic);
    skillIcons.push(sp);
  }
  const drawBase = (attrs: Attrs | null) => BASE.forEach(([key], i) => { baseText[i].string = attrs && attrs[key] !== undefined ? String(attrs[key]) : "-"; });
  const drawSkillIcons = (bid: number, star: number) => {
    let key = `${bid}_${star}`;
    while (skills && !skills.h[key] && star > 1) key = `${bid}_${--star}`;
    const ids = (skills?.h[key] ?? []).slice(0, 4);
    skillIcons.forEach((sp, i) => {
      sp.node.active = i < ids.length;
      sp.spriteFrame = null;
      const icon = i < ids.length ? skills!.k[String(ids[i])][2] : "";
      if (icon && hasFile(`icons/skill/${icon}.webp`)) spriteFrame(`icons/skill/${icon}.webp`).then(sf => { if (sp.isValid) sp.spriteFrame = sf; }, () => {});
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
      // the original (HeroMainInfoWindow.updateSpine) plays the model's "show" action, a large pose, from 240 below the node; stand2 is the fallback
      const pose = hasFile(`spine/hero/${model}/show.json`) ? "show" : "stand2";
      if (model) spineNode(`spine/hero/${model}/${pose}`, pose, modelNode).then(sk => sk.node.setPosition(0, -240, 0), e => console.warn(`hero info ${model}:`, (e as Error).message));
      drawAttrs(attrs);
      drawBase(attrs);
      levelText.string = `等级: ${h.lev}`;
      drawSkillIcons(h.bid, h.star);
      drawSkills(h.bid, h.star);
      curBid = h.bid;
      curStar = h.star;
      root.active = true;
    },
    setAttrs(partnerId, attrs) { if (partnerId === current) { drawAttrs(attrs); drawBase(attrs); } },
    close,
    onClose(f) { closeFn = f; },
  };
}

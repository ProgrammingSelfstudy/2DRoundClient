// The hero info window: the original `hero/hero_main_info_window` (HeroMainInfoWindow). Opened by tapping a cell of the hero list. Shows the
// window's own background, the hero's model (Spine, when the release carries it), name, camp, stars and power, and the attribute list the
// server sends in 11063 in the tab area, or the hero's skills (name, picture, text) from the client's own table. The other tabs (equipment, talent)
// have no page yet.
import { Color, Graphics, HorizontalTextAlignment, Label, Mask, Node, Sprite, SpriteFrame, UITransform, VerticalTextAlignment } from "cc";
import { atlasFrame, hasFile, loadJson, spriteFrame } from "./cdn";
import { LNode, buildLayout, opaqueBase } from "./ui";
import { dragScroll } from "./widgets";
import { W, H } from "./design";
import { spineNode } from "./spine";

export interface HeroInfo { partner_id: number; bid: number; lev: number; star: number; power: number; break_lev?: number }
type Attrs = { [key: string]: unknown };
interface PartnerTable { base: { [bid: string]: [string, number, number] }; head: { [key: string]: number } }
interface Models { p: { [key: string]: string } }
// hero_skill_info.json: the skills of a hero star in slot order, and per skill: name, text, picture, passive (0 or 1), note on how it opens
interface SkillInfo { h: { [heroStar: string]: number[] }; k: { [skill: string]: [string, string, string, number, string] } }

// hero_growth.json (hero_growth_table.py): lev = the items each level costs, brach = "type_breakid_break" -> level cap, extra condition, open skill slots,
// base = bid -> career, break id, position text, star = "bid_star" -> level cap of that star
interface Growth { lev: number[][][]; brach: { [key: string]: [number, number, number] }; base: { [bid: string]: [number, number, string] }; star: { [key: string]: number } }
const CAREER: { [type: number]: string } = { 0: "无", 2: "法师", 3: "战士", 4: "坦克", 5: "辅助" }; // HeroConst.CareerName
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

export interface HeroDetail { root: Node; open(h: HeroInfo, attrs: Attrs | null): void; setAssets(a: { coin: number; heroExp: number }): void; setAttrs(partnerId: number, attrs: Attrs): void; close(): void; onClose(f: () => void): void; onLevelUp(f: (h: HeroInfo) => void): void; onPreview(f: (h: HeroInfo) => void): void; onSwitch(f: (dir: number, from: HeroInfo) => void): void; onNotice(f: (text: string) => void): void }

export async function buildHeroDetail(canvas: Node): Promise<HeroDetail> {
  const [win, table, models, skills, trainTree, growth, items, equipTree] = await Promise.all([
    loadJson<LNode>("layouts/hero/hero_main_info_window.json"),
    loadJson<PartnerTable>("tables/partners.json"),
    loadJson<Models>("tables/battle_models.json"),
    loadJson<SkillInfo>("tables/hero_skill_info.json").catch(() => null), // a release without it just has no skill page
    loadJson<LNode>("layouts/hero/hero_main_tab_train_panel.json"),
    loadJson<Growth>("tables/hero_growth.json"),
    loadJson<{ [id: string]: [string, number] }>("tables/items.json"),
    loadJson<LNode>("layouts/hero/hero_main_tab_equip_panel.json"),
  ]);
  const built = await buildLayout(win, canvas, {
    // the camp backdrop (a picture by camp the release does not carry), the resonance timer, the reset button (the Lua hides it too) and the voice area
    hide: ["hero_camp_bg", "resonate_panel", "reset_btn", "voice_panel"],
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

  // the two round buttons at the lower left (the layout's tab_btn_1 and _2: 培养 and 升星; the Lua hides the other two until a feature shows them);
  // 培养 is the page that is shown, 升星 is not built
  let noticeFn = (_t: string) => {};
  const TABS = ["培养", "升星"];
  for (let i = 1; i <= 4; i++) {
    const btn = node("tab_btn").getChildByName(`tab_btn_${i}`)!;
    btn.active = i <= TABS.length;
    if (i > TABS.length) continue;
    const l = btn.getChildByName("label")!.getComponent(Label)!;
    l.string = TABS[i - 1];
    l.color = new Color(238, 209, 175, 255);
    l.outlineColor = new Color(83, 61, 50, 255);
    btn.getChildByName("select_img")!.active = false;
    btn.getChildByName("red_point")!.active = false;
    if (i === 2) btn.on(Node.EventType.TOUCH_END, () => noticeFn("暂未开放"));
  }
  // the buttons down the right side and the skin button: pictures of the layout; none of their features is built yet
  for (const name of ["comment_btn", "lock_btn", "share_btn", "skin_btn"]) node(name).on(Node.EventType.TOUCH_END, () => noticeFn("暂未开放"));
  let switchFn = (_dir: number, _from: HeroInfo) => {};
  node("left_btn").on(Node.EventType.TOUCH_END, () => { if (shownHero) switchFn(-1, shownHero); });
  node("right_btn").on(Node.EventType.TOUCH_END, () => { if (shownHero) switchFn(1, shownHero); });
  node("right_btn").setScale(-Math.abs(node("right_btn").scale.x), node("right_btn").scale.y, 1); // the layout draws both arrows pointing left; the right one is mirrored

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
  // the power: power_click holds the "战斗力" picture, the number is the Lua's CommonNum at (155, 25) of it
  const powerClick = node("power_click");
  const powerLabel = label(powerClick, "", 155 - 130, 25 - 20, HorizontalTextAlignment.CENTER, 30, 200);
  powerLabel.color = new Color(255, 232, 170, 255);
  powerLabel.outlineColor = new Color(70, 30, 10, 255);
  const container = node("tab_container");
  const list = new Node("attrs");
  list.layer = container.layer;
  list.addComponent(UITransform).setContentSize(680, 360);
  container.addChild(list);

  // The equipment panel (HeroMainTabEquipPanel, layout hero/hero_main_tab_equip_panel.csb) hangs on lay_hero, centred on it: four equipment slots (weapon, shoes,
  // clothes, hat) with the empty slot's silhouette, two locked slots (the level of the first, the star of the second) and the buttons "一键穿戴" / "一键卸下".
  // The client does not read what a hero wears yet, so the slots are shown empty.
  const equipBuilt = await buildLayout(equipTree, lay, {});
  const eq = (name: string) => equipBuilt.byName.get(name)!;
  equipBuilt.root.setPosition(-340, 0.5 * lay.getComponent(UITransform)!.height - 186.49, 0);
  const SILHOUETTE = [7, 10, 9, 8];
  SILHOUETTE.forEach((icon, i) => {
    const slot = new Node("equip_slot");
    slot.layer = lay.layer;
    slot.addComponent(UITransform).setContentSize(119, 119);
    slot.setScale(0.8, 0.8, 1);
    const fs = slot.addComponent(Sprite);
    fs.sizeMode = Sprite.SizeMode.CUSTOM;
    fs.color = new Color(92, 70, 60, 255); // the original's empty slot is dark brown; its background node is a csb whose tint this build does not read, so this is by eye
    atlasFrame(COMMON, "common_1005.png").then(sf => { if (fs.isValid) fs.spriteFrame = sf; }, () => {});
    const pic = new Node("empty_icon");
    pic.layer = lay.layer;
    pic.addComponent(UITransform);
    const ps = pic.addComponent(Sprite);
    ps.sizeMode = Sprite.SizeMode.RAW;
    atlasFrame("ui/hero/hero.json", `hero_info_${icon}.png`).then(sf => { if (ps.isValid) ps.spriteFrame = sf; }, () => {});
    slot.addChild(pic);
    slot.on(Node.EventType.TOUCH_END, () => noticeFn("暂未开放"));
    eq(`equip_node${i + 1}`).addChild(slot);
  });
  // the two locked slots: the Lua scales the lock, its text and the box by 0.8 / 0.9
  [["5", `${100}级解锁`], ["6", "7星解锁"]].forEach(([n, text]) => {
    for (const name of [`img_lock${n}`, `lab_lock${n}`]) eq(name).setScale(0.8, 0.8, 1);
    eq(`lab_lock${n}`).getComponent(Label)!.string = text;
    for (const name of [`artifacts_bg_${Number(n) - 4}`]) eq(name).setScale(0.9, 0.9, 1);
    const box = eq(`equip_node${n}`).getChildByName("box_34");
    box?.setScale(0.9, 0.9, 1);
  });
  for (const name of ["key_up_btn", "discharge_btn"]) eq(name).on(Node.EventType.TOUCH_END, () => noticeFn("暂未开放"));

  let current = 0, closeFn = () => {};

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

  // The original's page under the hero is the train panel (HeroMainTabTrainPanel), its layout hero/hero_main_tab_train_panel.csb: the break stars, the
  // level and what the next levels cost with the level button, the four base attributes and a "?" that opens the full list (HeroTipsAttrPanel), the
  // career and the position text, and the skill icons. It is centred in the window's tab_container; the tab buttons stay hidden.
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

  const GOLD = new Color(223, 204, 146, 255);
  // the window's tab_container sits under the semi-transparent background of the layout, so the panel goes on the window's root (above everything the
  // layout drew) at the container's middle, as the Lua centres it there
  const built2 = await buildLayout(trainTree, root, {});
  const tp = (name: string) => built2.byName.get(name)!;
  const ct = container.getComponent(UITransform)!;
  const mid = container.worldPosition.clone().add3f((0.5 - ct.anchorX) * ct.width, (0.5 - ct.anchorY) * ct.height, 0);
  const local = root.getComponent(UITransform)!.convertToNodeSpaceAR(mid);
  built2.root.setPosition(local.x - 340, local.y - 168, 0);
  attrPopup.setSiblingIndex(root.children.length); // the popups stay over the panel
  skillPopup.setSiblingIndex(root.children.length);
  const lb = (name: string) => tp(name).getComponent(Label)!;
  for (const key of ["levelKey", "levelupKey", "advancedKey"]) { lb(key).color = GOLD; lb(key).enableOutline = false; }
  tp("box_2012").active = false; // the layout hides it too
  // the level line is a rich label of the Lua: gold, 24, "level/cap" from the node's own place
  const levelLabel2 = lb("level");
  levelLabel2.color = GOLD; levelLabel2.fontSize = 24; levelLabel2.lineHeight = 28; levelLabel2.enableOutline = false;
  levelLabel2.horizontalAlign = HorizontalTextAlignment.LEFT; levelLabel2.overflow = Label.Overflow.NONE;
  for (const key of ["level_up_cost1", "level_up_cost2"]) { lb(key).enableOutline = false; lb(key).fontSize = 24; lb(key).lineHeight = 28; lb(key).horizontalAlign = HorizontalTextAlignment.LEFT; lb(key).overflow = Label.Overflow.NONE; }
  for (let i = 1; i <= 4; i++) { const l = lb(`attr_label${i}`); l.horizontalAlign = HorizontalTextAlignment.LEFT; l.overflow = Label.Overflow.NONE; l.fontSize = 26; l.lineHeight = 30; }
  const careerLabel = lb("profession_name");
  careerLabel.horizontalAlign = HorizontalTextAlignment.LEFT; careerLabel.overflow = Label.Overflow.NONE; careerLabel.fontSize = 24; careerLabel.lineHeight = 28;
  careerLabel.color = new Color(255, 255, 255, 255);
  tp("profession_icon").setPosition(369 - 340, tp("profession_icon").position.y, 0); // setPositionX(369) of the Lua, in the panel's own space
  careerLabel.node.setPosition(careerLabel.node.position.x - 22, careerLabel.node.position.y, 0);
  const intro = label(tp("tab_panel"), "", careerLabel.node.position.x + 52, careerLabel.node.position.y, HorizontalTextAlignment.LEFT, 24, 300);
  intro.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
  intro.overflow = Label.Overflow.NONE;
  const btn = tp("level_up_btn");
  const btnLabel = lb("label");
  btnLabel.fontSize = 30; btnLabel.lineHeight = 34; btnLabel.overflow = Label.Overflow.NONE;
  btnLabel.color = new Color(255, 255, 255, 255); btnLabel.outlineColor = new Color(30, 90, 120, 255);
  const redDot = new Node("red_point"); // addRedPointToNodeByStatus(btn, status, 5, 5): a red dot at the button's top right
  redDot.layer = root.layer;
  redDot.addComponent(UITransform).setContentSize(24, 24);
  redDot.setPosition(160.39 / 2 - 5, 60.53 / 2 - 5, 0);
  const rg = redDot.addComponent(Graphics);
  rg.fillColor = new Color(230, 40, 30, 255);
  rg.circle(0, 0, 11);
  rg.fill();
  btn.addChild(redDot);
  let levelUpFn = (_h: HeroInfo) => {};
  let shownHero: HeroInfo | null = null;
  btn.on(Node.EventType.TOUCH_END, () => { if (shownHero && shownHero.partner_id) levelUpFn(shownHero); });
  tp("look_btn").on(Node.EventType.TOUCH_END, () => { attrPopup.active = true; attrPopup.setSiblingIndex(root.children.length); });

  // the skill preview button, ours (the original has none): under the skill icons
  let previewFn = (_h: HeroInfo) => {};
  const prevBtn = new Node("skill_preview");
  prevBtn.layer = root.layer;
  prevBtn.addComponent(UITransform).setContentSize(200, 56);
  const pg = prevBtn.addComponent(Graphics);
  pg.fillColor = new Color(74, 51, 34, 235);
  pg.roundRect(-100, -28, 200, 56, 14);
  pg.fill();
  pg.strokeColor = new Color(248, 194, 60, 255);
  pg.lineWidth = 3;
  pg.roundRect(-100, -28, 200, 56, 14);
  pg.stroke();
  label(prevBtn, "技能预览", 0, 0, HorizontalTextAlignment.CENTER, 28, 200);
  prevBtn.on(Node.EventType.TOUCH_END, () => { if (shownHero) previewFn(shownHero); });
  tp("tab_panel").addChild(prevBtn);
  prevBtn.setPosition(576.37 - 340, 336 + 36 - 168, 0); // above the level button, where nothing of the original sits

  let wealth = { coin: 0, heroExp: 0 };
  const owned = (item: number) => (item === 22 ? wealth.heroExp : item === 1 ? wealth.coin : 0);
  const itemIcon = (name: string, item: number) => {
    const sp = tp(name).getComponent(Sprite) ?? tp(name).addComponent(Sprite); // the layout's picture is a placeholder with no atlas, so the node has no Sprite yet
    const info = items[String(item)];
    sp.spriteFrame = null;
    if (info && hasFile(`icons/item/${info[1]}.webp`)) spriteFrame(`icons/item/${info[1]}.webp`).then(sf => { if (sp.isValid) { sp.sizeMode = Sprite.SizeMode.RAW; sp.spriteFrame = sf; tp(name).setScale(0.3, 0.3, 1); } }, () => {});
  };
  const maxMark = new Node("max_level");
  maxMark.layer = root.layer;
  maxMark.addComponent(UITransform);
  maxMark.setPosition(167 - 340, 260 - 168, 0);
  maxMark.addComponent(Sprite).sizeMode = Sprite.SizeMode.RAW;
  maxMark.active = false;
  tp("tab_panel").addChild(maxMark);
  atlasFrame("ui/hero/hero.json", "txt_cn_hero_info_16.png").then(sf => { maxMark.getComponent(Sprite)!.spriteFrame = sf; }, () => {});

  // the break stars (updateAdvanceInfo): five, 35 apart from the advanced node, lit up to the hero's break step
  const stars: Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const st = new Node("break_star");
    st.layer = root.layer;
    st.addComponent(UITransform);
    st.setPosition(i * 35, 0, 0);
    const sp = st.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.RAW;
    st.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    tp("advanced_node").addChild(st);
    stars.push(sp);
  }
  const lit: { [k: string]: SpriteFrame } = {};
  Promise.all([atlasFrame("ui/hero/hero.json", "hero_info_1.png"), atlasFrame("ui/hero/hero.json", "hero_info_2.png")]).then(([a, b]) => { lit.on = a; lit.off = b; }, () => {});

  // what the level button does and shows (updateInfo / updateCostInfo): the cap of the hero's break step, the cost of up to five levels it can pay
  // (one level from 60), "升X级" or "升 级", a cap reached with a next break "进阶", and the "满级" mark when nothing more is open
  const drawTrain = (h: HeroInfo) => {
    const base = growth.base[String(h.bid)];
    const brk = h.break_lev ?? 0;
    const step = base ? growth.brach[`${base[0]}_${base[1]}_${brk}`] : undefined;
    const next = base ? growth.brach[`${base[0]}_${base[1]}_${brk + 1}`] : undefined;
    let cap = step?.[0] ?? 0;
    if (!next) cap = Math.max(cap, growth.star[`${h.bid}_${h.star}`] ?? 0);
    levelLabel2.string = `${h.lev}/${cap}`;
    stars.forEach((sp, i) => { sp.spriteFrame = (i < brk ? lit.on : lit.off) ?? null; });
    const own = h.partner_id !== 0;
    let money: number[][] = [];
    let k = 0;
    const atCap = h.lev >= cap;
    if (own && !atCap) {
      const tries = h.lev < 60 ? 5 : 1;
      const sum: { [item: number]: number } = {};
      for (let n = 0; n < tries && h.lev + n < cap; n++) {
        const row = growth.lev[h.lev + n - 1] ?? [];
        const total: { [item: number]: number } = { ...sum };
        for (const [item, qty] of row) total[item] = (total[item] ?? 0) + qty;
        if (!row.every(([item]) => owned(item) >= total[item])) { if (n === 0) Object.assign(sum, total); break; }
        Object.assign(sum, total);
        k = n + 1;
      }
      const firstRow = growth.lev[h.lev - 1] ?? [];
      money = firstRow.map(([item]) => [item, sum[item] ?? 0]);
    }
    const showCost = own && !atCap;
    tp("bg_1").active = showCost;
    ["item_icon1", "item_icon2"].forEach((name, i) => {
      tp(name).active = showCost && !!money[i];
      if (money[i]) itemIcon(name, money[i][0]);
    });
    ["level_up_cost1", "level_up_cost2"].forEach((name, i) => {
      const l = lb(name);
      l.string = showCost && money[i] ? String(money[i][1]) : "";
      l.color = showCost && money[i] && owned(money[i][0]) < money[i][1] ? new Color(199, 12, 12, 255) : new Color(71, 44, 30, 255);
    });
    maxMark.active = own && atCap && !next;
    btn.active = own && (!atCap || !!next);
    btnLabel.string = atCap ? "进阶" : k > 1 ? `升${k}级` : "升 级";
    redDot.active = btn.active && !atCap && k > 0;
    // the career and the position text (the career icon is common_900(45 + type))
    const type = base?.[0] ?? 4;
    atlasFrame(COMMON, `common_900${45 + type}.png`).then(sf => { const sp = tp("profession_icon").getComponent(Sprite)!; if (sp.isValid) sp.spriteFrame = sf; }, () => {});
    careerLabel.string = CAREER[type] ?? "无";
    intro.string = base?.[2] ?? "";
  };
  const BASE: string[] = ["atk", "hp", "def", "speed"];
  BASE.forEach((key, i) => atlasFrame("ui/hero/hero.json", `hero_info_attr_${key}.png`).then(sf => { const sp = tp(`attr_icon${i + 1}`).getComponent(Sprite)!; if (sp.isValid) sp.spriteFrame = sf; }, () => {}));
  const drawBase = (attrs: Attrs | null) => BASE.forEach((key, i) => { lb(`attr_label${i + 1}`).string = attrs && attrs[key] !== undefined ? String(attrs[key]) : "-"; });

  // the skill icons (SkillItem, scale 0.8: the frame common_1005 at 119, the picture, the level badge common_2018, grey when the break step has not opened the slot);
  // the slot 1 normal attack is not shown; the skill_container is 630 wide and the icons sit 116 apart, centred
  const skillRow = tp("skill_container");
  const skillNodes: Node[] = [];
  const drawSkillIcons = (h: HeroInfo) => {
    skillNodes.forEach(n => n.destroy());
    skillNodes.length = 0;
    let key = `${h.bid}_${h.star}`, st = h.star;
    while (skills && !skills.h[key] && st > 1) key = `${h.bid}_${--st}`;
    const ids = (skills?.h[key] ?? []).slice(1);
    const base = growth.base[String(h.bid)];
    const open = base ? growth.brach[`${base[0]}_${base[1]}_${h.break_lev ?? 0}`]?.[2] ?? 99 : 99;
    const left = (630 - 116 * ids.length) / 2 + 58;
    ids.forEach((id, i) => {
      const item = new Node("skill_item");
      item.layer = root.layer;
      item.addComponent(UITransform).setContentSize(119, 119);
      item.setPosition(left + 116 * i - 315, 0, 0);
      item.setScale(0.8, 0.8, 1);
      const frame = new Node("frame");
      frame.layer = root.layer;
      frame.addComponent(UITransform).setContentSize(119, 119);
      const fs = frame.addComponent(Sprite);
      fs.sizeMode = Sprite.SizeMode.CUSTOM;
      atlasFrame(COMMON, "common_1005.png").then(sf => { if (fs.isValid) fs.spriteFrame = sf; }, () => {});
      item.addChild(frame);
      const pic = new Node("icon");
      pic.layer = root.layer;
      pic.addComponent(UITransform);
      const ps = pic.addComponent(Sprite);
      ps.sizeMode = Sprite.SizeMode.RAW;
      const icon = skills!.k[String(id)][2];
      if (icon && hasFile(`icons/skill/${icon}.webp`)) spriteFrame(`icons/skill/${icon}.webp`).then(sf => { if (ps.isValid) ps.spriteFrame = sf; }, () => {});
      item.addChild(pic);
      const badge = new Node("level_bg");
      badge.layer = root.layer;
      badge.addComponent(UITransform);
      badge.setPosition(10 - 59.5, 108 - 59.5, 0);
      const bs = badge.addComponent(Sprite);
      bs.sizeMode = Sprite.SizeMode.RAW;
      atlasFrame(COMMON, "common_2018.png").then(sf => { if (bs.isValid) bs.spriteFrame = sf; }, () => {});
      item.addChild(badge);
      const num = label(item, String(id % 100 || 1), 8 - 59.5, 107 - 59.5, HorizontalTextAlignment.CENTER, 20, 30);
      num.color = new Color(100, 50, 35, 255);
      num.enableOutline = false;
      const locked = i + 2 > open; // the slot number is the position in the star's skill list, the normal attack being 1
      if (locked) for (const sp of [fs, ps, bs]) sp.grayscale = true;
      item.on(Node.EventType.TOUCH_END, () => { skillPopup.active = true; skillPopup.setSiblingIndex(root.children.length); });
      skillRow.addChild(item);
      skillNodes.push(item);
    });
  };

  const close = () => { root.active = false; closeFn(); };
  node("close_btn").on(Node.EventType.TOUCH_END, close);

  return {
    root,
    open(h, attrs) {
      current = h.partner_id;
      shownHero = h;
      const base = table.base[String(h.bid)];
      nameLabel.string = base?.[0] ?? String(h.bid);
      powerLabel.string = String(h.power);
      for (const name of ["left_btn", "right_btn"]) node(name).active = h.partner_id !== 0; // a library card is not in a list of yours
      equipBuilt.root.active = h.partner_id !== 0; // and wears nothing
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
      // the model: only the heroes whose Spine the release carries show one
      modelNode.removeAllChildren();
      const model = models.p[`${h.bid}_${h.star}`];
      // the original (HeroMainInfoWindow.updateSpine) plays the model's "show" action, a large pose, from 240 below the node; stand2 is the fallback
      const pose = hasFile(`spine/hero/${model}/show.json`) ? "show" : "stand2";
      if (model) spineNode(`spine/hero/${model}/${pose}`, pose, modelNode).then(sk => sk.node.setPosition(0, -240, 0), e => console.warn(`hero info ${model}:`, (e as Error).message));
      drawAttrs(attrs);
      drawBase(attrs);
      drawTrain(h);
      drawSkillIcons(h);
      drawSkills(h.bid, h.star);
      curBid = h.bid;
      curStar = h.star;
      root.active = true;
    },
    setAttrs(partnerId, attrs) { if (partnerId === current) { drawAttrs(attrs); drawBase(attrs); } },
    setAssets(a) { wealth = a; if (root.active && shownHero) drawTrain(shownHero); },
    close,
    onClose(f) { closeFn = f; },
    onLevelUp(f) { levelUpFn = f; },
    onPreview(f) { previewFn = f; },
    onSwitch(f) { switchFn = f; },
    onNotice(f) { noticeFn = f; },
  };
}

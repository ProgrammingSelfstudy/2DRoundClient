// Boot: runs when the project scripts load. The scene only has a Canvas and a camera; the UI is built in code.
// It logs in with the shared network layer (the same code the web dev page runs) and prints what the server answered.
import { Canvas, Color, Director, HorizontalTextAlignment, Label, Node, UITransform, VerticalTextAlignment, director, view } from "cc";
import { GameSocket } from "./shared/net";
import { Session } from "./shared/session";
import { enterGame } from "./shared/login";
import { loadMainCity } from "./shared/city";

const ACCOUNT = "mini01";
const PASSWORD = "secret12";

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
  const canvas = director.getScene()!.getComponentInChildren(Canvas)!.node;
  const size = view.getVisibleSize();
  const node = new Node("status");
  node.layer = canvas.layer;
  node.addComponent(UITransform).setContentSize(size.width - 40, size.height - 40);
  const label = node.addComponent(Label);
  label.fontSize = 28;
  label.lineHeight = 38;
  label.overflow = Label.Overflow.RESIZE_HEIGHT;
  label.horizontalAlign = HorizontalTextAlignment.LEFT;
  label.verticalAlign = VerticalTextAlignment.TOP;
  label.color = new Color(255, 255, 255, 255);
  canvas.addChild(node);

  const lines: string[] = ["2DRound 新客户端（Creator 3.8.8）", `账号 ${ACCOUNT}`];
  const show = () => (label.string = lines.join("\n"));
  const marks = { doing: "…", done: "✓", fail: "✗" };
  const at = new Map<string, number>();
  show();

  const sock = new GameSocket();
  const session = new Session(sock);
  const step = (name: string, state: "doing" | "done" | "fail", detail?: string) => {
    const text = `${marks[state]} ${name}${detail ? "：" + detail : ""}`;
    const i = at.get(name);
    if (i === undefined) at.set(name, lines.push(text) - 1);
    else lines[i] = text;
    show();
  };
  const url = `ws://${location.hostname}:8802/ws`;
  enterGame(session, url, ACCOUNT, PASSWORD, step)
    .then(() => loadMainCity(session, step))
    .then(city => {
      const r = city.role as Record<string, unknown>;
      const a = city.assets as Record<string, unknown>;
      const d = city.drama as Record<string, unknown>;
      lines.push("", `${r.name}  Lv${r.lev}  战力 ${r.power}`, `金币 ${a.gold}  coin ${a.coin}  体力 ${a.energy}/${a.energy_max}`,
        `主线：第 ${d.chapter_id} 章，关卡 ${d.dun_id}`, `英雄 ${city.partners.length}  任务 ${city.quests.length}`);
      show();
    })
    .catch(() => {
      // the failing step is already shown with ✗
    });
});

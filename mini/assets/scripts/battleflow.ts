// Plays one campaign fight against the server, in the order the original does (see internal/game/fight.go of the server):
//   13003 -> 20000, 20027 (who fights)   20001 (the scene is ready) -> 20001, 20002 (round start)
//   20019 (start animation over) -> 20004 (the attacks)   20005 (attacks played) -> 20002 of the next round, or 13016 (the result)
import type { Session } from "./shared/session";
import type { Msg } from "./shared/proto/codec";
import type { BattleScene } from "./battlescene";

// a queue of the frames of some commands, so a push that arrives before the code asks for it is not lost
export class Feed {
  private queue: { cmd: number; msg: Msg }[] = [];
  private waiter: { cmds: number[]; resolve: (m: { cmd: number; msg: Msg }) => void } | null = null;

  constructor(session: Session, cmds: number[]) {
    for (const cmd of cmds) session.on(cmd, msg => {
      this.queue.push({ cmd, msg });
      this.wake();
    });
  }

  clear() { this.queue = []; }

  private wake() {
    const w = this.waiter;
    if (!w) return;
    const i = this.queue.findIndex(q => w.cmds.indexOf(q.cmd) >= 0);
    if (i < 0) return;
    this.waiter = null;
    w.resolve(this.queue.splice(i, 1)[0]);
  }

  take(cmds: number[], timeoutMs = 10000): Promise<{ cmd: number; msg: Msg }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(new Error(`战斗中等不到 ${cmds.join("/")}`)); }, timeoutMs);
      this.waiter = { cmds, resolve: m => { clearTimeout(timer); resolve(m); } };
      this.wake();
    });
  }
}

const MAX_ROUNDS = 15; // the round limit of a campaign fight (maxFightRounds of the server)

// `opening` is the 20027 of the fight; resolves with the result (13016) when the last round has been played. The caller clears the feed before
// it asks for the fight, so nothing of an earlier fight is left in it and nothing of this one is thrown away.
export async function runFight(session: Session, feed: Feed, scene: BattleScene, opening: Msg, mapId: number): Promise<Msg> {
  await scene.start(opening, mapId);
  scene.show(true);
  session.send(20001, {});
  let next = await feed.take([20002]);
  for (let round = 0; round < 60; round++) { // the server's script never runs this long
    scene.round(Number(next.msg.action_count) || round + 1, MAX_ROUNDS);
    session.send(20019, {});
    const plays = await feed.take([20004]);
    await scene.play((plays.msg.skill_plays as Msg[] | undefined) ?? []);
    session.send(20005, {});
    next = await feed.take([20002, 13016]);
    if (next.cmd === 13016) return next.msg;
  }
  throw new Error("战斗回合数过多");
}

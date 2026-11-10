// The formation window of the campaign (11211 reads it, 11212 saves it; kind 0 is the campaign's). The hero page opens it to save only; the stage
// page opens it with a fight button, which saves and then starts what the caller passed.
import { App } from "./app";
import { Formation, buildFormPanel } from "./formpanel";

export interface FormationFeature { open(onFight?: () => Promise<void>): Promise<void> }

export function formationFeature(app: App): FormationFeature {
  const { session, store, windows } = app;
  let fight: (() => Promise<void>) | null = null; // what the fight button starts, set by whoever opened the window last

  const save = async (f: Formation): Promise<boolean> => {
    const pos_info = f.slots.map((h, i) => (h ? { pos: i + 1, id: h.partner_id } : null)).filter(Boolean);
    const reply = await session.request(11212, { type: 0, formation_type: f.formation_type, hallows_id: 0, pos_info } as never, 11212);
    if (Number(reply.code) !== 1) app.toast(String(reply.msg ?? "保存失败"));
    return Number(reply.code) === 1;
  };

  const win = windows.define("full", async parent => {
    const form = await buildFormPanel(parent, app.toast);
    form.onSave(async f => { try { return await save(f); } catch (e) { app.toast((e as Error).message); return false; } });
    form.onFight(async f => {
      try { if (!(await save(f))) return; } catch (e) { return app.toast((e as Error).message); }
      form.close();
      if (fight) await fight().catch(e => app.toast((e as Error).message));
    });
    return form;
  }, w => w.close());

  return {
    async open(onFight) {
      fight = onFight ?? null;
      await store.refreshHeroes().catch(e => console.warn("hero list:", (e as Error).message)); // heroes summoned or granted since login
      const reply = await session.request(11211, { type: 0 }, 11211);
      (await win.front()).open(reply, store.heroes, !!onFight);
    },
  };
}

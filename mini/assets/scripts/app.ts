// What every feature of the game works with once the player is logged in: the connection, the player's data, the windows.
import type { Session } from "./shared/session";
import type { Store } from "./store";
import type { Windows } from "./windows";

export interface App {
  session: Session;
  store: Store;
  windows: Windows;
  query: URLSearchParams; // the page's own ?key=value, for the dev conveniences
  toast(text: string): void;
}

// run what a tap started; what goes wrong (the server did not answer, a file did not load) is told to the player instead of being lost
export function attempt(app: App, f: () => Promise<unknown>): void {
  f().catch(e => {
    console.warn(`${(e as Error).stack || e}`);
    app.toast((e as Error).message);
  });
}

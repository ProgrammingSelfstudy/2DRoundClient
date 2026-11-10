// The window manager: every page and window of the game is defined once (which layer it lives on, how it is built, how it is hidden) and is
// built the first time somebody asks for it. The layers are nodes over the canvas in a fixed order, so what covers what no longer depends on
// the order the pages happened to be built in.
import { Node, UITransform } from "cc";
import { W, H } from "./design";

// from the bottom up:
//   scene  the main city picture
//   page   the pages of the bottom tabs (heroes, backpack, stages), one at a time
//   full   full-screen windows the top bar and the tabs still cover (hero info, the library, the formation); a tab switch closes them
//   battle the battle scene, which a tab switch leaves alone
//   bar    the top bar and the bottom tabs
//   popup  windows over everything (quick battle, rewards, the result of a fight)
//   tip    short messages
export const LAYERS = ["scene", "page", "full", "battle", "bar", "popup", "tip"] as const;
export type Layer = (typeof LAYERS)[number];

export interface Win<T> {
  get(): Promise<T>; // the window, built now if this is the first time
  front(): Promise<T>; // the same, and moved over the other windows of its layer
  ready(): T | null; // the window if it has been built, without building it
  hide(): void; // nothing to do when it was never built
}

interface Entry { layer: Layer; hide(): void }

export class Windows {
  private layers = new Map<Layer, Node>();
  private entries: Entry[] = [];

  constructor(canvas: Node) {
    for (const name of LAYERS) {
      const n = new Node(`layer_${name}`);
      n.layer = canvas.layer;
      n.addComponent(UITransform).setContentSize(W, H); // centred on the canvas like the canvas itself, so a page is placed as it was on the canvas
      canvas.addChild(n);
      this.layers.set(name, n);
    }
  }

  layer(name: Layer): Node {
    return this.layers.get(name)!;
  }

  // `build` gets the layer's node as the parent; `hide` is how the manager closes the window (a tab switch, hideLayer)
  define<T extends { root: Node }>(layer: Layer, build: (parent: Node) => Promise<T>, hide: (w: T) => void): Win<T> {
    let made: T | null = null;
    let making: Promise<T> | null = null;
    const get = () => {
      if (!making) {
        making = build(this.layer(layer)).then(w => (made = w));
        making.catch(() => { making = null; }); // a build that failed (a file that did not load) is tried again at the next call
      }
      return making;
    };
    const win: Win<T> = {
      get,
      async front() {
        const w = await get();
        const parent = w.root.parent;
        if (parent) w.root.setSiblingIndex(parent.children.length - 1);
        return w;
      },
      ready: () => made,
      hide: () => { if (made) hide(made); },
    };
    this.entries.push({ layer, hide: win.hide });
    return win;
  }

  hideLayer(layer: Layer): void {
    for (const e of this.entries) if (e.layer === layer) e.hide();
  }

  // take everything off the canvas (a login that failed half-way starts from nothing again)
  destroy(): void {
    this.layers.forEach(n => n.destroy());
    this.layers.clear();
    this.entries = [];
  }
}

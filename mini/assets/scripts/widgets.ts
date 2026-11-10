// Controls the pages share.
import { Node } from "cc";

export interface Scroll {
  range(lo: number, hi: number): void; // how far the content may go along the axis (its position), set when the content is filled
  moved(): number; // how far the finger has travelled since it went down: a cell under it takes a short travel as a tap, a long one as a drag
}

// Drag `content` inside `view` along one axis. The view is the node that takes the touch (and clips, when it has a Mask); the content keeps its
// place on the other axis. There is no fling and no bounce yet; when they come they come here, for every list at once.
export function dragScroll(view: Node, content: Node, axis: "x" | "y"): Scroll {
  let lo = 0, hi = 0, travel = 0;
  view.on(Node.EventType.TOUCH_START, () => { travel = 0; });
  view.on(Node.EventType.TOUCH_MOVE, (e: { getUIDelta(): { x: number; y: number } }) => {
    const d = e.getUIDelta()[axis];
    travel += Math.abs(d);
    const p = content.position;
    const to = Math.min(hi, Math.max(lo, p[axis] + d));
    content.setPosition(axis === "x" ? to : p.x, axis === "y" ? to : p.y, 0);
  });
  return {
    range(a, b) { lo = Math.min(a, b); hi = Math.max(a, b); },
    moved: () => travel,
  };
}

// The first frame of a newly started animation must not include work done before it started.
// Creator calculates dt at the frame boundary, then updates Spine in postUpdate; loading a
// model between those boundaries can otherwise advance its first frame by the whole load.
interface AnimationClock {
  paused: boolean;
  updateAnimation(dt: number): void;
}
interface StartClock { startedAt: number | null; now: () => number }
const starts = new WeakMap<AnimationClock, StartClock>();

export function armAnimationStart(skeleton: AnimationClock, now = () => performance.now()): void {
  let clock = starts.get(skeleton);
  if (!clock) {
    clock = { startedAt: null, now };
    starts.set(skeleton, clock);
    const update = skeleton.updateAnimation;
    const start = clock;
    skeleton.updateAnimation = function (dt: number): void {
      if (start.startedAt !== null && !this.paused) {
        const elapsed = Math.max(0, (start.now() - start.startedAt) / 1000);
        // Disarm before the update: an event callback may start another animation on this skeleton.
        start.startedAt = null;
        dt = Math.min(Math.max(0, dt), elapsed);
      }
      update.call(this, dt);
    };
  }
  clock.now = now;
  clock.startedAt = now();
}

// Only the selected cast's resources are submitted. Two loads at a time keep network/parse
// work bounded; yielding between batches lets the loading label and standing scene draw.
// Cancellation stops new batches and parsing; in-flight loads finish in the existing cache.
export async function prepareSelectedResources<T>(
  resources: readonly string[],
  load: (base: string) => Promise<T>,
  prepare: (resource: T) => void,
  yieldFrame: () => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const selected = Array.from(new Set(resources));
  for (let i = 0; i < selected.length && isCurrent(); i += 2) {
    await Promise.all(selected.slice(i, i + 2).map(async base => {
      const resource = await load(base);
      if (isCurrent()) prepare(resource);
    }));
    if (isCurrent()) await yieldFrame();
  }
}

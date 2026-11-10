// Spine models from the release (spine/<fx|hero>/<model>/<action>.{json,atlas,webp}); the .json was converted from the original's Spine 3.4
// binary by pipeline/skel_to_json.py, because Creator's runtime is 3.8 and cannot read the 3.4 binary.
import { Node, UITransform, sp } from "cc";
import { fileUrl, texture, texturePma } from "./cdn";

const models = new Map<string, Promise<sp.SkeletonData>>();
const pma = new Set<sp.SkeletonData>(); // the models whose pictures were loaded premultiplied (see below)

// give a skeleton its model; this, not `skeletonData =` alone, so that it draws premultiplied pictures as such
export function setModel(s: sp.Skeleton, data: sp.SkeletonData): void {
  s.skeletonData = data;
  s.premultipliedAlpha = pma.has(data);
}

// `base` is "spine/fx/E51130/action": the skeleton, atlas and the pages the atlas names, loaded once per model
export function spineData(base: string): Promise<sp.SkeletonData> {
  let p = models.get(base);
  if (!p) {
    p = (async () => {
      const dir = base.slice(0, base.lastIndexOf("/") + 1);
      const [json, atlas] = await Promise.all([
        fetch(fileUrl(base + ".json")).then(r => r.json()),
        fetch(fileUrl(base + ".atlas")).then(r => r.text()),
      ]);
      const pageNames = atlas.split(/\r?\n/).map(l => l.trim()).filter(l => /\.png$/i.test(l));
      const sd = new sp.SkeletonData();
      sd.skeletonJson = json;
      sd.atlasText = atlas;
      sd.textureNames = pageNames;
      // a model with a "screen" or "multiply" slot needs premultiplied pictures (cdn.ts texturePma); the others keep the plain ones
      const blended = ((json as { slots?: { blend?: string }[] }).slots || []).some(s => s.blend === "screen" || s.blend === "multiply");
      const load = blended ? texturePma : texture;
      sd.textures = await Promise.all(pageNames.map(n => load(dir + n.replace(/\.png$/i, ".webp"))));
      if (blended) pma.add(sd);
      return sd;
    })();
    models.set(base, p);
  }
  return p;
}

// a node playing `anim` of the model, looping; it sits at the skeleton's origin like the original's createEffectSpine
export async function spineNode(base: string, anim: string, parent: Node): Promise<sp.Skeleton> {
  const n = new Node("spine");
  n.layer = parent.layer;
  n.addComponent(UITransform);
  const s = n.addComponent(sp.Skeleton);
  setModel(s, await spineData(base));
  s.setAnimation(0, anim, true);
  parent.addChild(n);
  return s;
}

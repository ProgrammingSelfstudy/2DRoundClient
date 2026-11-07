// Spine models from the release (spine/<fx|hero>/<model>/<action>.{json,atlas,webp}); the .json was converted from the original's Spine 3.4
// binary by pipeline/skel_to_json.py, because Creator's runtime is 3.8 and cannot read the 3.4 binary.
import { Node, UITransform, sp } from "cc";
import { fileUrl, texture } from "./cdn";

const models = new Map<string, Promise<sp.SkeletonData>>();

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
      sd.textures = await Promise.all(pageNames.map(n => texture(dir + n.replace(/\.png$/i, ".webp"))));
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
  s.skeletonData = await spineData(base);
  s.premultipliedAlpha = false;
  s.setAnimation(0, anim, true);
  parent.addChild(n);
  return s;
}

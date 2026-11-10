// Resources come from the CDN at run time, never from the project: the server (/client/config) says where the release manifest is, the
// manifest maps a logical path ("boot/loading_bg.webp") to a file named by its content hash. See docs/PATHS.md.
import { ImageAsset, Rect, Size, SpriteFrame, Texture2D, Vec2, assetManager } from "cc";

interface ClientConfig {
  cdn_base: string;
  force_update: boolean;
  notice: string;
  release: { version: string; manifest_url: string } | null;
}
interface Manifest {
  version: string;
  files: { [logical: string]: { hash: string; ext: string; bytes: number; w: number; h: number } };
}

const LOGIN_API = "/loginapi"; // the page's own server forwards this to the login service
export const PLATFORM = "h5";
export const CLIENT_VERSION = "0.1";

let cdnBase = "";
let manifest: Manifest | null = null;
const frames = new Map<string, Promise<SpriteFrame>>();

export async function loadRelease(): Promise<{ version: string; notice: string; forceUpdate: boolean }> {
  const res = await fetch(`${LOGIN_API}/client/config?platform=${PLATFORM}&ver=${CLIENT_VERSION}`);
  if (!res.ok) throw new Error(`/client/config ${res.status}`);
  const cfg = (await res.json()) as ClientConfig;
  if (!cfg.release) throw new Error("服务器没有已发布的资源版本");
  cdnBase = cfg.cdn_base.replace(/\/$/, "");
  const mres = await fetch(cfg.release.manifest_url, { cache: "no-cache" });
  if (!mres.ok) throw new Error(`manifest ${mres.status}`);
  manifest = (await mres.json()) as Manifest;
  return { version: manifest.version, notice: cfg.notice, forceUpdate: cfg.force_update };
}

export function fileUrl(logical: string): string {
  const f = manifest?.files[logical];
  if (!f) throw new Error(`资源清单里没有 ${logical}`);
  return `${cdnBase}/f/${f.hash.slice(0, 2)}/${f.hash}.${f.ext}`;
}

// whether the release carries a file (a model's action file may be missing: its animation then lives in another file of the model)
export function hasFile(logical: string): boolean {
  return !!manifest?.files[logical];
}

const pages = new Map<string, Promise<Texture2D>>();

// the texture of an image in the manifest; loaded once and shared by every frame cut from it
export function texture(logical: string): Promise<Texture2D> {
  let p = pages.get(logical);
  if (!p) {
    p = new Promise<Texture2D>((resolve, reject) => {
      const f = manifest?.files[logical];
      if (!f) return reject(new Error(`资源清单里没有 ${logical}`));
      assetManager.loadRemote<ImageAsset>(fileUrl(logical), { ext: "." + f.ext }, (err, img) => {
        if (err || !img) return reject(err ?? new Error(`加载失败 ${logical}`));
        const tex = new Texture2D();
        tex.image = img;
        resolve(tex);
      });
    });
    pages.set(logical, p);
  }
  return p;
}

const pmaPages = new Map<string, Promise<Texture2D>>();

// The same image with its colours multiplied by its alpha. A Spine slot blended as "screen" or "multiply" takes the colour of a pixel whatever its
// alpha, so the colour a picture keeps in its transparent parts would show (a green band across 索隆's purple slash); the original's engine
// premultiplies every PNG as it loads, and so must the models that have such slots (spine.ts).
export function texturePma(logical: string): Promise<Texture2D> {
  let p = pmaPages.get(logical);
  if (!p) {
    p = (async () => {
      const res = await fetch(fileUrl(logical));
      if (!res.ok) throw new Error(`${logical}: ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none" });
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data; // straight alpha
      const out = new Uint8Array(px.length);
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        out[i] = (px[i] * a + 127) / 255;
        out[i + 1] = (px[i + 1] * a + 127) / 255;
        out[i + 2] = (px[i + 2] * a + 127) / 255;
        out[i + 3] = a;
      }
      const tex = new Texture2D();
      tex.image = new ImageAsset({ _data: out, _compressed: false, width: c.width, height: c.height, format: Texture2D.PixelFormat.RGBA8888 });
      return tex;
    })();
    pmaPages.set(logical, p);
  }
  return p;
}

// a whole image as one sprite frame
export function spriteFrame(logical: string): Promise<SpriteFrame> {
  let p = frames.get(logical);
  if (!p) {
    p = texture(logical).then(tex => {
      const sf = new SpriteFrame();
      sf.texture = tex;
      return sf;
    });
    frames.set(logical, p);
  }
  return p;
}

export async function loadJson<T>(logical: string): Promise<T> {
  const res = await fetch(fileUrl(logical));
  if (!res.ok) throw new Error(`${logical}: ${res.status}`);
  return (await res.json()) as T;
}

interface AtlasFrame { x: number; y: number; w: number; h: number; rotated: boolean; ox: number; oy: number; sw: number; sh: number; }
interface Atlas { texture: string; size: number[]; frames: { [name: string]: AtlasFrame }; }
const atlases = new Map<string, Promise<Atlas>>();

// One frame of an atlas ("ui/common/common.json", "common_1002.png"). `cap` is the nine-slice middle rectangle (x, y, w, h, measured from the
// top-left of the frame, as Cocos Studio writes it); with it the frame stretches without distorting its corners.
export async function atlasFrame(atlas: string, name: string, cap?: number[]): Promise<SpriteFrame> {
  let a = atlases.get(atlas);
  if (!a) atlases.set(atlas, (a = loadJson<Atlas>(atlas)));
  const at = await a;
  const f = at.frames[name];
  if (!f) throw new Error(`${atlas} 里没有 ${name}`);
  const sf = new SpriteFrame();
  sf.texture = await texture(at.texture);
  sf.rect = new Rect(f.x, f.y, f.w, f.h);
  sf.rotated = f.rotated;
  sf.offset = new Vec2(f.ox, f.oy);
  sf.originalSize = new Size(f.sw, f.sh);
  if (cap) {
    sf.insetLeft = cap[0];
    sf.insetRight = f.w - cap[0] - cap[2];
    sf.insetTop = cap[1];
    sf.insetBottom = f.h - cap[1] - cap[3];
  }
  return sf;
}

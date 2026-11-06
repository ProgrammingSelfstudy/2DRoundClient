// Resources come from the CDN at run time, never from the project: the server (/client/config) says where the release manifest is, the
// manifest maps a logical path ("boot/loading_bg.webp") to a file named by its content hash. See docs/PATHS.md.
import { ImageAsset, SpriteFrame, Texture2D, assetManager } from "cc";

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

// a sprite frame for a logical path; loaded once and shared
export function spriteFrame(logical: string): Promise<SpriteFrame> {
  let p = frames.get(logical);
  if (!p) {
    p = new Promise<SpriteFrame>((resolve, reject) => {
      const f = manifest?.files[logical];
      if (!f) return reject(new Error(`资源清单里没有 ${logical}`));
      assetManager.loadRemote<ImageAsset>(fileUrl(logical), { ext: "." + f.ext }, (err, img) => {
        if (err || !img) return reject(err ?? new Error(`加载失败 ${logical}`));
        const tex = new Texture2D();
        tex.image = img;
        const sf = new SpriteFrame();
        sf.texture = tex;
        resolve(sf);
      });
    });
    frames.set(logical, p);
  }
  return p;
}

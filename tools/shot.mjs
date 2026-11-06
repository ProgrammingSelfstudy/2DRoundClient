#!/usr/bin/env node
// Open a URL in a headless Chrome with software WebGL (SwiftShader), wait in real time, save a screenshot and print the console output.
// The automation browser used elsewhere has no WebGL, so this is how a Cocos page gets looked at.
//
//   node tools/shot.mjs <url> <out.png> [waitSeconds=12] [width=720] [height=1280] [step ...]
// steps run in order after the wait: click:x,y   drag:x1,y1,x2,y2 (press, move in steps, release)   type:text (into the focused field)   wait:seconds   shot:file.png (an extra screenshot)
// eval:<js> (run in the page and print the result)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, wait = "12", w = "720", h = "1280", ...steps] = process.argv.slice(2);
if (!url || !out) { console.error("usage: shot.mjs <url> <out.png> [waitSeconds] [width] [height] [step ...]"); process.exit(2); }
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), "shot-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
  "--ignore-gpu-blocklist", "--no-first-run", "--disable-extensions", `--window-size=${w},${h}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = code => { chrome.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(code); };
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === "page"); } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp connect failed")); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === "Runtime.consoleAPICalled") logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? "").join(" "));
    else if (m.method === "Runtime.exceptionThrown") logs.push("[exception] " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  };
  const call = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url });
  await sleep(+wait * 1000);
  const save = async file => writeFileSync(file, Buffer.from((await call("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  for (const st of steps) {
    if (st.startsWith("click:")) {
      const [x, y] = st.slice(6).split(",").map(Number);
      for (const type of ["mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      await sleep(1000);
    } else if (st.startsWith("drag:")) {
      const [x1, y1, x2, y2] = st.slice(5).split(",").map(Number);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
      for (let i = 1; i <= 10; i++) await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / 10, y: y1 + ((y2 - y1) * i) / 10, button: "left", buttons: 1 });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
      await sleep(1000);
    } else if (st.startsWith("type:")) {
      await call("Input.insertText", { text: st.slice(5) });
      await sleep(500);
    } else if (st.startsWith("eval:")) {
      const r = await call("Runtime.evaluate", { expression: st.slice(5), returnByValue: true, awaitPromise: true });
      console.log("eval>", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result));
    } else if (st.startsWith("wait:")) await sleep(+st.slice(5) * 1000);
    else if (st.startsWith("shot:")) await save(st.slice(5));
  }
  await save(out);
  console.log(logs.filter(l => !/GL Driver|PHYSICS|bullet|Init /.test(l)).slice(-25).join("\n"));
  console.log("saved", out);
  done(0);
} catch (e) { console.error(String(e)); done(1); }

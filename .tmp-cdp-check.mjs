/**
 * 用真实浏览器验证网格、参考线和吸附。
 *
 * 这个脚本只在开发期跑，用完即删：它不属于产品代码。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.argv[2] ?? "http://localhost:4178/";
const profile = mkdtempSync(join(tmpdir(), "pptd-cdp-"));
const port = 9223;

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1600,1000",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  throw new Error("找不到 Chrome 调试目标");
}

const wsUrl = await findTarget();
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });

let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  id += 1;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: URL });
await sleep(4000);

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
};

// 画布辅助层的存在性
const layers = await evaluate(`(() => ({
  grid: !!document.querySelector('.canvas-grid-layer'),
  guides: document.querySelectorAll('.canvas-guide').length,
  toolbar: document.querySelectorAll('.assist-tools .tool-button').length,
  canvas: !!document.querySelector('.slide-canvas'),
  canvasBox: (() => { const c = document.querySelector('.slide-canvas'); const r = c?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })(),
}))()`);
console.log("初始状态:", JSON.stringify(layers));

// 点击"添加垂直参考线"和"添加水平参考线"
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assist-tools .tool-button')];
  buttons.find((b) => b.getAttribute('aria-label') === '添加垂直参考线')?.click();
  buttons.find((b) => b.getAttribute('aria-label') === '添加水平参考线')?.click();
  return true;
})()`);
await sleep(500);

const afterGuides = await evaluate(`(() => ({
  guides: document.querySelectorAll('.canvas-guide').length,
  vertical: document.querySelectorAll('.canvas-guide.vertical').length,
  horizontal: document.querySelectorAll('.canvas-guide.horizontal').length,
  positions: [...document.querySelectorAll('.canvas-guide')].map((g) => ({ axis: g.className.includes('vertical') ? 'x' : 'y', left: g.style.left, top: g.style.top })),
}))()`);
console.log("添加参考线后:", JSON.stringify(afterGuides));

// 网格开关
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assist-tools .tool-button')];
  buttons.find((b) => b.getAttribute('aria-label') === '关闭网格')?.click();
  return true;
})()`);
await sleep(300);
const gridOff = await evaluate(`!!document.querySelector('.canvas-grid-layer')`);
console.log("关闭网格后网格层存在:", gridOff);
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assist-tools .tool-button')];
  buttons.find((b) => b.getAttribute('aria-label') === '显示网格')?.click();
  return true;
})()`);
await sleep(300);
const gridOn = await evaluate(`!!document.querySelector('.canvas-grid-layer')`);
console.log("重新打开网格后网格层存在:", gridOn);

// 加一个形状，然后拖它，观察是否吸附到页面中线
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.insert-tools .tool-button')];
  buttons.find((b) => b.getAttribute('aria-label') === '矩形')?.click();
  return true;
})()`);
await sleep(500);

const before = await evaluate(`(() => {
  const el = document.querySelector('.slide-element.selected') || document.querySelector('.slide-element');
  const r = el?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2 } : null;
})()`);
console.log("拖拽前:", JSON.stringify(before));

if (before) {
  // 把它拖到接近页面中线的位置：中心离中线差 3 像素，阈值内应吸附
  const canvas = await evaluate(`(() => { const r = document.querySelector('.slide-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const targetCenterX = canvas.x + canvas.w / 2;
  const startX = before.x + before.w / 2;
  const startY = before.y + before.h / 2;
  const endX = targetCenterX + 3; // 故意偏 3 像素
  const endY = startY;

  const dispatch = async (type, x, y) => evaluate(`(() => {
    const el = document.querySelector('.slide-element.selected') || document.querySelector('.slide-element');
    const ev = new PointerEvent('${type}', { clientX: ${x}, clientY: ${y}, bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: ${type === 'pointerup' ? 0 : 1} });
    el.dispatchEvent(ev);
    return true;
  })()`);

  await dispatch("pointerdown", startX, startY);
  await sleep(120);
  await dispatch("pointermove", endX, endY);
  await sleep(200);
  const during = await evaluate(`(() => {
    const el = document.querySelector('.slide-element.selected');
    const r = el?.getBoundingClientRect();
    const snap = document.querySelector('.canvas-snap-line');
    return { cx: r ? r.x + r.width / 2 : null, snapLine: !!snap, snapLeft: snap?.style.left ?? null };
  })()`);
  console.log("拖拽中:", JSON.stringify(during));
  await dispatch("pointerup", endX, endY);
  await sleep(300);

  const after = await evaluate(`(() => {
    const el = document.querySelector('.slide-element.selected');
    const r = el?.getBoundingClientRect();
    return r ? { cx: r.x + r.width / 2, x: r.x } : null;
  })()`);
  console.log("拖拽后:", JSON.stringify(after));
  const canvas2 = await evaluate(`(() => { const r = document.querySelector('.slide-canvas').getBoundingClientRect(); return { x: r.x, w: r.width }; })()`);
  console.log("页面中线 x =", canvas2.x + canvas2.w / 2, "  元素中心 x =", after?.cx);
  console.log("吸附误差(px) =", after ? Math.abs(after.cx - (canvas2.x + canvas2.w / 2)) : "n/a");
}

// 撤销后网格与参考线仍在（它们不属于文稿）
await evaluate(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  return true;
})()`);
await sleep(400);
const afterUndo = await evaluate(`(() => ({
  guides: document.querySelectorAll('.canvas-guide').length,
  grid: !!document.querySelector('.canvas-grid-layer'),
  elements: document.querySelectorAll('.slide-element').length,
}))()`);
console.log("撤销后（辅助层应保留，文稿元素应回退）:", JSON.stringify(afterUndo));

writeFileSync(join(tmpdir(), "pptd-cdp-result.json"), JSON.stringify({ layers, afterGuides, gridOff, gridOn, before, afterUndo }, null, 2));
socket.close();
chrome.kill();
console.log("完成");

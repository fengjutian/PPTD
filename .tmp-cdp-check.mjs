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
const port = 9224;

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

const clickToolbar = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.assist-tools .tool-button, .insert-tools .tool-button')]
    .find((x) => x.getAttribute('aria-label') === '${label}');
  b?.click();
  return !!b;
})()`);

const canvasBox = () => evaluate(`(() => { const r = document.querySelector('.slide-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);

const report = {};

// 1. 初始状态
report.initial = await evaluate(`(() => ({
  grid: !!document.querySelector('.canvas-grid-layer'),
  guides: document.querySelectorAll('.canvas-guide').length,
  assistButtons: [...document.querySelectorAll('.assist-tools .tool-button')].map((b) => b.getAttribute('aria-label')),
}))()`);
console.log("初始状态:", JSON.stringify(report.initial));

// 2. 添加参考线
await clickToolbar("添加垂直参考线");
await clickToolbar("添加水平参考线");
await sleep(400);
report.afterGuides = await evaluate(`(() => ({
  guides: document.querySelectorAll('.canvas-guide').length,
  vertical: document.querySelectorAll('.canvas-guide.vertical').length,
  horizontal: document.querySelectorAll('.canvas-guide.horizontal').length,
  positions: [...document.querySelectorAll('.canvas-guide')].map((g) => ({ axis: g.className.includes('vertical') ? 'x' : 'y', left: g.style.left, top: g.style.top })),
}))()`);
console.log("添加参考线后:", JSON.stringify(report.afterGuides));

// 3. 网格显示开关
await clickToolbar("关闭网格");
await sleep(250);
report.gridOff = await evaluate(`!!document.querySelector('.canvas-grid-layer')`);
console.log("关闭网格后网格层仍存在:", report.gridOff);
await clickToolbar("显示网格");
await sleep(250);
report.gridOn = await evaluate(`!!document.querySelector('.canvas-grid-layer')`);
console.log("重新打开网格后网格层存在:", report.gridOn);

// 4. 网格吸附开关（与显示网格相互独立）
await clickToolbar("吸附到网格");
await sleep(250);
report.gridSnapLabel = await evaluate(`(() => {
  const b = [...document.querySelectorAll('.assist-tools .tool-button')].find((x) => x.getAttribute('aria-label') === '关闭网格吸附');
  return !!b;
})()`);
console.log("网格吸附已开启:", report.gridSnapLabel);
await clickToolbar("关闭网格吸附");
await sleep(250);

// 5. 加一个矩形并拖动
await clickToolbar("矩形");
await sleep(500);
const canvas = await canvasBox();
const before = await evaluate(`(() => {
  const el = document.querySelector('.slide-element.selected');
  const r = el?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2 } : null;
})()`);
console.log("拖拽前:", JSON.stringify(before), " 画布:", JSON.stringify(canvas));

const dispatch = (type, x, y) => evaluate(`(() => {
  const el = document.querySelector('.slide-element.selected');
  if (!el) return false;
  const ev = new PointerEvent('${type}', { clientX: ${x}, clientY: ${y}, bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: ${type === 'pointerup' ? 0 : 1} });
  el.dispatchEvent(ev);
  return true;
})()`);

const dragTo = async (endX, endY) => {
  const startX = before.x + before.w / 2;
  const startY = before.y + before.h / 2;
  await dispatch("pointerdown", startX, startY);
  await sleep(100);
  await dispatch("pointermove", endX, endY);
  await sleep(180);
  const during = await evaluate(`(() => {
    const el = document.querySelector('.slide-element.selected');
    const r = el?.getBoundingClientRect();
    const snap = document.querySelector('.canvas-snap-line');
    return { cx: r ? r.x + r.width / 2 : null, snapShown: !!snap, snapLeft: snap?.style.left ?? null };
  })()`);
  await dispatch("pointerup", endX, endY);
  await sleep(250);
  const after = await evaluate(`(() => {
    const el = document.querySelector('.slide-element.selected');
    const r = el?.getBoundingClientRect();
    return r ? { cx: r.x + r.width / 2, x: r.x } : null;
  })()`);
  return { during, after };
};

// 5a. 拖到离页面中线 3 像素处：应该吸到中线
const centerDrag = await dragTo(canvas.cx + 3, before.y + before.h / 2);
console.log("拖到中线附近 →", JSON.stringify(centerDrag));
console.log("  页面中线 x =", canvas.cx, " 元素中心 x =", centerDrag.after?.cx, " 误差 =", centerDrag.after ? Math.abs(centerDrag.after.cx - canvas.cx).toFixed(2) : "n/a");
report.centerDrag = centerDrag;

// 5b. 拖到参考线上（参考线在页面中线，所以同一个位置）
const guideDrag = await dragTo(canvas.cx + 40, before.y + before.h / 2);
console.log("拖到参考线之外 →", JSON.stringify(guideDrag));
console.log("  元素中心 x =", guideDrag.after?.cx, "（离中线 40 像素，超阈值，不应吸附）");
report.awayDrag = guideDrag;

// 6. 撤销：辅助层保留，文稿对象回退
await evaluate(`(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  return true;
})()`);
await sleep(400);
report.afterUndo = await evaluate(`(() => ({
  guides: document.querySelectorAll('.canvas-guide').length,
  grid: !!document.querySelector('.canvas-grid-layer'),
  elements: document.querySelectorAll('.slide-element').length,
}))()`);
console.log("撤销后（辅助层保留，对象回退）:", JSON.stringify(report.afterUndo));

writeFileSync(join(tmpdir(), "pptd-cdp-result.json"), JSON.stringify(report, null, 2));
socket.close();
chrome.kill();
console.log("完成");

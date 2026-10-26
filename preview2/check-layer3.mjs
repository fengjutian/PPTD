import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9228;
const URL = "http://localhost:5199/preview2/layer3.html";
const PROFILE = "D:\\github\\PPTD\\.tmp\\edge-layer3";
const OUT = "D:\\github\\PPTD\\preview2";

const child = spawn(
  EDGE,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=380,840",
    URL,
  ],
  { stdio: "ignore" },
);
const exitTimer = setTimeout(() => {
  child.kill();
  process.exit(2);
}, 90_000);
exitTimer.unref?.();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let target;
for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    target = targets.find((item) => item.type === "page" && item.url.includes("layer3"));
  } catch {
    // still starting
  }
  if (!target) await delay(250);
}
if (!target) throw new Error("no page target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
function send(method, params = {}) {
  const id = (nextId += 1);
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result?.result?.value;
}
async function shot(name) {
  const response = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT}\\${name}.png`, Buffer.from(response.result.data, "base64"));
}
async function setInput(value) {
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="图层名称"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await delay(100);
}

await send("Emulation.setDeviceMetricsOverride", {
  width: 380,
  height: 840,
  deviceScaleFactor: 1,
  mobile: false,
});
for (let attempt = 0; attempt < 50; attempt += 1) {
  if ((await evaluate("document.querySelectorAll('[data-layer-id]').length")) === 6) break;
  await delay(200);
}

await evaluate("window.__commands = []");
await shot("layer3-dark");
console.log(
  "hidden row:",
  await evaluate(
    "(() => { const row = document.querySelector('[data-layer-id=\"i1\"]'); return { className: row.className, name: row.querySelector('.layer-name')?.textContent, eye: row.querySelector('[aria-label$=\"图层\"]')?.getAttribute('aria-label'), pressed: row.querySelector('[aria-label$=\"图层\"]')?.getAttribute('aria-pressed') }; })()",
  ),
);

// Show the hidden picture with its row eye.
await evaluate("document.querySelector('[data-layer-id=\"i1\"] [aria-label=\"显示图层\"]').click()");
await delay(150);
console.log("show i1:", await evaluate("window.__commands"));

// Hide a visible layer with its row eye.
await evaluate("window.__commands = []");
await evaluate("document.querySelector('[data-layer-id=\"t3\"] [aria-label=\"隐藏图层\"]').click()");
await delay(150);
console.log("hide t3:", await evaluate("window.__commands"));

// Double-click the name to rename; Enter commits one command.
await evaluate("window.__commands = []");
await evaluate(
  "(() => { const name = document.querySelector('[data-layer-id=\"i1\"] .layer-name'); name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return true; })()",
);
await delay(200);
console.log(
  "editing:",
  await evaluate(
    "({ input: document.querySelector('input[aria-label=\"图层名称\"]')?.value ?? null, placeholder: document.querySelector('input[aria-label=\"图层名称\"]')?.placeholder ?? null })",
  ),
);
await setInput("  右侧   光轨图  ");
await shot("layer3-rename");
await evaluate(
  "document.querySelector('input[aria-label=\"图层名称\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))",
);
await delay(200);
console.log("rename command:", await evaluate("window.__commands"));

// F2 on a focused row starts the editor; Escape cancels without a command.
await evaluate("window.__commands = []");
await evaluate("document.querySelector('[data-layer-id=\"t3\"]').focus()");
await evaluate(
  "document.querySelector('[data-layer-id=\"t3\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }))",
);
await delay(200);
const hadInput = await evaluate("Boolean(document.querySelector('input[aria-label=\"图层名称\"]'))");
await evaluate("document.querySelector('input[aria-label=\"图层名称\"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
await delay(150);
console.log("f2/escape:", { hadInput, commands: await evaluate("window.__commands") });

// The context menu offers rename and hide; rename opens the inline editor.
await evaluate(
  "(() => { const row = document.querySelector('[data-layer-id=\"s2\"]'); const rect = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 18 })); return true; })()",
);
await delay(200);
console.log(
  "menu labels:",
  await evaluate("[...document.querySelectorAll('.layer-menu [role=\"menuitem\"]')].map((item) => item.textContent)"),
);
await evaluate(
  "[...document.querySelectorAll('.layer-menu [role=\"menuitem\"]')].find((item) => item.textContent.includes('重命名')).click()",
);
await delay(250);
console.log(
  "menu rename input:",
  await evaluate("Boolean(document.querySelector('input[aria-label=\"图层名称\"]'))"),
);
await evaluate("document.querySelector('input[aria-label=\"图层名称\"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");

// Light theme screenshot of the visibility state.
await evaluate("document.documentElement.dataset.theme = 'light'");
await delay(100);
await shot("layer3-light");

socket.close();
child.kill();
clearTimeout(exitTimer);
console.log("done");
process.exit(0);

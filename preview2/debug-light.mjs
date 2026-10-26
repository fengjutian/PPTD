import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9230;
const URL = "http://localhost:5199/preview2/layer3.html?theme=light";
const PROFILE = "C:\\Users\\Charles.feng\\AppData\\Local\\Temp\\pptd-edge-layer3-debug2";

const child = spawn(
  EDGE,
  [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=380,840",
    URL,
  ],
  { stdio: "ignore" },
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let target;
for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    target = targets.find((item) => item.type === "page" && item.url.includes("layer3"));
  } catch {
    // starting
  }
  if (!target) await delay(250);
}
if (!target) throw new Error("no page");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
function send(method, params = {}) {
  const current = (id += 1);
  socket.send(JSON.stringify({ id: current, method, params }));
  return new Promise((resolve) => pending.set(current, resolve));
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result?.result?.value;
}
for (let attempt = 0; attempt < 40; attempt += 1) {
  if ((await evaluate("document.querySelectorAll('[data-layer-id]').length")) === 6) break;
  await delay(200);
}
console.log(
  "PAGE:",
  await evaluate(
    "({ text: document.body.innerText.slice(0, 120), rows: document.querySelectorAll('[data-layer-id]').length, theme: document.documentElement.dataset.theme })",
  ),
);
console.log(
  await evaluate(`(() => {
    const row = document.querySelector('[data-layer-id="t1"]');
    const active = document.querySelector('.layer-row.active');
    return {
      theme: document.documentElement.dataset.theme,
      rowClass: row?.className,
      rowColor: row ? getComputedStyle(row).color : null,
      nameColor: row ? getComputedStyle(row.querySelector('.layer-name')).color : null,
      activeClass: active?.className,
      activeColor: active ? getComputedStyle(active).color : null,
      activeName: active ? getComputedStyle(active.querySelector('.layer-name')).color : null,
      rowOpacity: row ? getComputedStyle(row).opacity : null,
    };
  })()`),
);
const shot = await send("Page.captureScreenshot", { format: "png" });
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile("D:\\github\\PPTD\\preview2\\layer3-light-static.png", Buffer.from(shot.result.data, "base64")),
);
socket.close();
child.kill();
process.exit(0);

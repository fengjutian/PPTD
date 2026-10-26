import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9229;
const URL = "http://localhost:5199/preview2/layer3.html";
const PROFILE = "D:\\github\\PPTD\\.tmp\\edge-layer3-debug";

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
  if (message.method === "Runtime.exceptionThrown") {
    console.log("EXCEPTION:", message.params.exceptionDetails?.exception?.description ?? message.params);
  }
  if (message.method === "Runtime.consoleAPICalled") {
    console.log("CONSOLE:", message.params.type, message.params.args?.map((arg) => arg.value ?? arg.description).join(" "));
  }
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
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await delay(3000);
const result = await send("Runtime.evaluate", {
  expression: "({ text: document.body.innerText.slice(0, 200), root: document.querySelector('#root')?.innerHTML.length ?? -1 })",
  returnByValue: true,
});
console.log("PAGE:", result.result?.result?.value);
socket.close();
child.kill();
console.log("done");
process.exit(0);

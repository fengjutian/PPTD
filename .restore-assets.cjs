const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const appData = process.env.APPDATA + "/com.pptd.desktop";
const recovery = `${appData}/recovery/latest.pptd`;
const recoveryAssets = `${appData}/recovery/latest.pptd.assets`;
const cacheRoot = `${appData}/layout-render-cache`;

const document = JSON.parse(fs.readFileSync(recovery, "utf8"));
const references = new Set();
for (const slide of document.slides ?? []) {
  for (const element of slide.elements ?? []) {
    if (element.type !== "image") continue;
    const reference = element.source?.dataUrl ?? "";
    if (reference.startsWith("asset://")) references.add(reference.slice("asset://".length));
  }
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cacheFiles = [];
for (const entry of fs.readdirSync(cacheRoot)) {
  const dir = path.join(cacheRoot, entry);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".png")) cacheFiles.push(path.join(dir, name));
  }
}

fs.mkdirSync(recoveryAssets, { recursive: true });
let restored = 0;
let missing = 0;
for (const reference of references) {
  const target = path.join(recoveryAssets, reference);
  if (fs.existsSync(target)) {
    console.log("already present:", reference);
    continue;
  }
  const wanted = reference.replace(/\.(png|jpg|webp)$/, "");
  const source = cacheFiles.find((file) => sha256(file) === wanted);
  if (!source) {
    console.log("NO SOURCE FOUND for", reference);
    missing++;
    continue;
  }
  fs.copyFileSync(source, target);
  const check = sha256(target);
  if (check !== wanted) {
    console.log("HASH MISMATCH after copy:", reference);
    missing++;
    continue;
  }
  console.log("restored:", reference, "<-", path.basename(source));
  restored++;
}
console.log(`done. restored=${restored} missing=${missing}`);

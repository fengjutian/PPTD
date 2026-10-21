// Mirrors extract_template_regions() + extract_text_style() from
// src-tauri/src/commands/project_file.rs against the real template, so the
// end-to-end check uses exactly what the desktop app would receive.
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const templatePath = process.argv[2];
const outPath = process.argv[3];
const zip = await JSZip.loadAsync(readFileSync(templatePath));

const text = async (name) => (zip.file(name) ? zip.file(name).async("string") : undefined);

const presentation = await text("ppt/presentation.xml");
const sizeMatch = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentation ?? "");
const slideWidth = Number(sizeMatch[1]);
const slideHeight = Number(sizeMatch[2]);

// theme colors, keyed by the clrScheme child name
const themeXml = await text("ppt/theme/theme1.xml");
const theme = new Map();
for (const match of (themeXml ?? "").matchAll(/<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>(?:<a:(?:sysClr|srgbClr)[^>]*?(?:lastClr|val)="([0-9A-Fa-f]{6})")/g)) {
  theme.set(match[1].toLowerCase(), `#${match[2]}`);
}

const parseElements = (xml) => {
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tagPattern = /<\/?([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)\/?>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let match;
  let cursor = 0;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [raw, name, rawAttrs] = match;
    const between = xml.slice(cursor, match.index);
    cursor = match.index + raw.length;
    stack[stack.length - 1].text = (stack[stack.length - 1].text ?? "") + between;
    if (raw.startsWith("<?") || raw.startsWith("<!--")) continue;
    if (raw.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const attrPattern = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(rawAttrs ?? "")) !== null) attrs[attrMatch[1]] = attrMatch[2];
    const node = { name: name.includes(":") ? name.split(":")[1] : name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!raw.endsWith("/>")) stack.push(node);
  }
  return root;
};

const descendants = (node) => {
  const out = [];
  const walk = (current) => { for (const child of current.children) { out.push(child); walk(child); } };
  walk(node);
  return out;
};
const findFirst = (node, name) => descendants(node).find((candidate) => candidate.name === name);

const resolveScheme = (value) => {
  const key = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" }[value.toLowerCase()] ?? value.toLowerCase();
  return theme.get(key);
};

const textStyle = (shape) => {
  const body = findFirst(shape, "txBody");
  if (!body) return {};
  let textColor;
  let fontSizePt;
  for (const node of descendants(body)) {
    if (!["rPr", "defRPr", "endParaRPr"].includes(node.name)) continue;
    if (fontSizePt === undefined) {
      const size = Number(node.attrs.sz);
      if (Number.isFinite(size) && size >= 100) fontSizePt = Math.round(size / 100);
    }
    if (textColor === undefined) {
      const fill = node.children.find((child) => child.name === "solidFill");
      const colorNode = fill?.children.find((child) => ["srgbClr", "sysClr", "schemeClr"].includes(child.name));
      if (!colorNode) continue;
      if (colorNode.name === "srgbClr") textColor = `#${colorNode.attrs.val}`;
      else if (colorNode.name === "sysClr") textColor = `#${colorNode.attrs.lastClr}`;
      else textColor = resolveScheme(colorNode.attrs.val ?? "");
    }
  }
  return { textColor, fontSizePt };
};

const layoutNumbers = Object.keys(zip.files)
  .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
  .map((name) => Number(/slideLayout(\d+)\.xml$/.exec(name)[1]))
  .sort((left, right) => left - right);

const layouts = [];
for (const number of layoutNumbers) {
  const xml = await text(`ppt/slideLayouts/slideLayout${number}.xml`);
  if (!xml) continue;
  const document = parseElements(xml);
  const name = findFirst(document, "cSld")?.attrs.name ?? "未命名版式";
  const regions = [];
  for (const shape of descendants(document)) {
    if (shape.name !== "sp" && shape.name !== "pic") continue;
    const transform = findFirst(shape, "xfrm");
    const offset = transform?.children.find((child) => child.name === "off");
    const extent = transform?.children.find((child) => child.name === "ext");
    if (!offset || !extent) continue;
    const x = Number(offset.attrs.x); const y = Number(offset.attrs.y);
    const width = Number(extent.attrs.cx); const height = Number(extent.attrs.cy);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width === 0 || height === 0) continue;
    const placeholder = findFirst(shape, "ph");
    const hasText = descendants(shape).some((node) => node.name === "t" && (node.text ?? "").trim() !== "");
    let role;
    if (shape.name === "pic" || (placeholder && ["pic", "clipArt", "media"].includes(placeholder.attrs.type))) role = "image";
    else if (placeholder && ["title", "ctrTitle"].includes(placeholder.attrs.type)) role = "title";
    else if ((placeholder && ["body", "obj", "subTitle"].includes(placeholder.attrs.type)) || hasText) role = "body";
    else continue;
    regions.push({ role, x, y, width, height, ...textStyle(shape) });
    if (regions.length >= 32) break;
  }
  layouts.push({ index: number, name, regions });
}

writeFileSync(outPath, JSON.stringify({ slideWidthEmu: slideWidth, slideHeightEmu: slideHeight, theme: [...theme.entries()], layouts }, null, 2), "utf8");
console.log(`slide=${slideWidth}x${slideHeight} layouts=${layouts.length} theme=${JSON.stringify([...theme.entries()])}`);
for (const layout of layouts) {
  const regions = layout.regions.filter((r) => r.role !== "image").map((r) => `${r.role}[${(r.x / slideWidth).toFixed(3)},${(r.y / slideHeight).toFixed(3)} ${(r.width / slideWidth).toFixed(3)}x${(r.height / slideHeight).toFixed(3)}${r.textColor ? ` ink=${r.textColor}` : ""}${r.fontSizePt ? ` ${r.fontSizePt}pt` : ""}]`).join(" ");
  console.log(`${layout.index}\t${layout.name}\t${regions}`);
}

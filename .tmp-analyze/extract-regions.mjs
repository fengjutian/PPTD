// Replicates extract_template_regions() from src-tauri/src/commands/project_file.rs
// against the real 昆佰泰 template, so layout scoring can be designed on facts.
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const templatePath = process.argv[2];
const outPath = process.argv[3];

const zip = await JSZip.loadAsync(readFileSync(templatePath));

const text = async (name) => {
  const entry = zip.file(name);
  return entry ? entry.async("string") : undefined;
};

const presentation = await text("ppt/presentation.xml");
const sizeMatch = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentation ?? "");
const slideWidth = Number(sizeMatch[1]);
const slideHeight = Number(sizeMatch[2]);

// Minimal element walker: yields { name, attrs, children } for every element in document order.
const parseElements = (xml) => {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const tagPattern = /<\/?([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)\/?>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let match;
  let cursor = 0;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [raw, name, rawAttrs] = match;
    const between = xml.slice(cursor, match.index);
    cursor = match.index + raw.length;
    if (stack.length > 1) {
      const parent = stack[stack.length - 1];
      parent.text = (parent.text ?? "") + between;
    }
    if (raw.startsWith("<?")) continue;
    if (raw.startsWith("<!--")) continue;
    if (raw.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    const attrPattern = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(rawAttrs ?? "")) !== null) attrs[attrMatch[1]] = attrMatch[2];
    const node = { name: name.includes(":") ? name.split(":")[1] : name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!raw.endsWith("/>")) stack.push(node);
  }
  return root;
};

const descendants = (node) => {
  const out = [];
  const walk = (current) => {
    for (const child of current.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
};

const findFirst = (node, name) => descendants(node).find((candidate) => candidate.name === name);

const extractRegions = (document) =>
  descendants(document)
    .filter((node) => node.name === "sp" || node.name === "pic")
    .map((shape) => {
      const transform = findFirst(shape, "xfrm");
      if (!transform) return undefined;
      const offset = transform.children.find((child) => child.name === "off");
      const extent = transform.children.find((child) => child.name === "ext");
      if (!offset || !extent) return undefined;
      const x = Number(offset.attrs.x);
      const y = Number(offset.attrs.y);
      const width = Number(extent.attrs.cx);
      const height = Number(extent.attrs.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
      if (width === 0 || height === 0) return undefined;
      const placeholder = findFirst(shape, "ph");
      const hasText = descendants(shape).some((node) => node.name === "t" && (node.text ?? "").trim() !== "");
      let role;
      if (shape.name === "pic" || (placeholder && ["pic", "clipArt", "media"].includes(placeholder.attrs.type))) role = "image";
      else if (placeholder && ["title", "ctrTitle"].includes(placeholder.attrs.type)) role = "title";
      else if ((placeholder && ["body", "obj", "subTitle"].includes(placeholder.attrs.type)) || hasText) role = "body";
      else return undefined;
      return { role, x, y, width, height };
    })
    .filter(Boolean)
    .slice(0, 32);

const extractBackgroundColor = (document) => {
  const background = findFirst(document, "bg");
  if (!background) return undefined;
  const fill = findFirst(background, "solidFill");
  if (!fill) return undefined;
  const color = fill.children.find((child) => child.name);
  if (!color) return undefined;
  if (color.name === "srgbClr") return `#${color.attrs.val}`;
  if (color.name === "sysClr") return `#${color.attrs.lastClr}`;
  if (color.name === "schemeClr") return color.attrs.val;
  return undefined;
};

// collect raw text of a:t nodes for hasText check
const withText = (node) => {
  const out = [];
  const walk = (current) => {
    for (const child of current.children) {
      if (child.name === "t") out.push(child.text ?? "");
      walk(child);
    }
  };
  walk(node);
  return out.join("");
};

const layoutFiles = Object.keys(zip.files)
  .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
  .map((name) => Number(/slideLayout(\d+)\.xml$/.exec(name)[1]))
  .sort((left, right) => left - right);

const rows = [];
for (const number of layoutFiles) {
  const xml = await text(`ppt/slideLayouts/slideLayout${number}.xml`);
  if (!xml) continue;
  const document = parseElements(xml);
  const cSld = findFirst(document, "cSld");
  const name = cSld?.attrs.name ?? "未命名版式";
  // Rust uses roxmltree descendants() over the whole doc, including the layout's own <p:sp> list.
  const regions = extractRegions(document).map((region) => ({
    role: region.role,
    x: region.x / slideWidth,
    y: region.y / slideHeight,
    width: region.width / slideWidth,
    height: region.height / slideHeight,
  }));
  rows.push({ index: number, name, backgroundColor: extractBackgroundColor(document), regions });
}

const lines = rows.map((row) => {
  const regions = row.regions
    .map((region) => `${region.role}[${region.x.toFixed(3)},${region.y.toFixed(3)} ${region.width.toFixed(3)}x${region.height.toFixed(3)}]`)
    .join(" ");
  return `${row.index}\t${row.name}\tbg=${row.backgroundColor ?? "-"}\t${regions}`;
});
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`slide=${slideWidth}x${slideHeight} layouts=${rows.length}`);
console.log(lines.join("\n"));

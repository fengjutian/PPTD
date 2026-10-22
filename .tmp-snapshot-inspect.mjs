import { readFileSync } from "node:fs";
const p = process.env.APPDATA + "\\com.pptd.desktop\\recovery\\latest.pptd";
const d = JSON.parse(readFileSync(p, "utf8"));
const byLayout = new Map();
d.slides.forEach((s, i) => {
  const key = s.layoutId ?? "(none)";
  if (!byLayout.has(key)) byLayout.set(key, { count: 0, firstSlide: i, backgrounds: new Set(), titles: [] });
  const entry = byLayout.get(key);
  entry.count += 1;
  entry.backgrounds.add(s.background);
  if (entry.titles.length < 3) entry.titles.push(s.content.title);
});
for (const [id, v] of byLayout) {
  console.log(id, "slides:", v.count, "first:", v.firstSlide, "bg:", [...v.backgrounds].join(","), "| titles:", v.titles.join(" / "));
}
console.log("--- theme in doc:", JSON.stringify(d.theme));
console.log("--- image elements:", d.slides.flatMap((s) => s.elements).filter((e) => e.type === "image").map((e) => e.source.dataUrl.slice(0, 30) + " placement=" + e.placement).join("\n"));

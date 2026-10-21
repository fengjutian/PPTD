import JSZip from "jszip";
import { readFileSync } from "node:fs";

const zip = await JSZip.loadAsync(readFileSync("C:/Users/Charles.feng/Downloads/20250211昆佰泰ppt模板.pptx"));
for (const n of [1, 7, 11, 14]) {
  const xml = await zip.file(`ppt/slideLayouts/slideLayout${n}.xml`).async("string");
  const sps = xml.split("<p:sp>").slice(1);
  console.log(`--- layout${n} ---`);
  sps.forEach((sp, i) => {
    const ph = /<p:ph[^>]*type="([a-zA-Z]+)"/.exec(sp);
    const type = ph ? ph[1] : "(none)";
    const idx = /<p:ph[^>]*idx="(\d+)"/.exec(sp);
    const colors = [...sp.matchAll(/<a:solidFill><a:(srgbClr|schemeClr) val="([0-9A-Za-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    const sizes = [...sp.matchAll(/ sz="(\d+)"/g)].map((m) => m[1]);
    console.log(`  sp${i} ph=${type}${idx ? `/idx${idx[1]}` : ""} colors=${JSON.stringify(colors.slice(0, 5))} sz=${JSON.stringify(sizes.slice(0, 4))}`);
  });
}

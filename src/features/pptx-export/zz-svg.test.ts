import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import PptxGenJS from "pptxgenjs";

describe("svg in pptx", () => {
  it("writes an svg icon", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2F6B5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    const slide = pptx.addSlide();
    slide.background = { color: "FBFAF7" };
    slide.addText("图标测试", { x: 0.5, y: 0.4, w: 6, h: 0.8, fontFace: "Microsoft YaHei", fontSize: 32, color: "1E2A32" });
    slide.addImage({ data: dataUrl, x: 1, y: 2, w: 2, h: 2 });
    writeFileSync("D:/github/PPTD/.tmp/real/icon-test.pptx", Buffer.from((await pptx.write({ outputType: "nodebuffer" })) as Buffer));
  });
});

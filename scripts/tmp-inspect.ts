import { applyCommand } from "../src/core/commands/commands";
import { createDocument, type PresentationDocument } from "../src/core/document-model";

const items = [
  "总写洞庭湖全景",
  "'衔远山,吞长江,浩浩汤汤'",
  "描写气象万千的景色",
  "过渡到登楼览物之情",
  "'前人之述备矣'引出下文",
];

const content = {
  title: "原文赏析——第二段",
  body: items.join("\n"),
  speakerNotes: "",
  blocks: [{ type: "bullet-list" as const, items }],
};

const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };

const document = createDocument();
applyCommand(document, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] });

const slide = document.slides[0]!;
const height = document.pageSize.height;
console.log("=== 元素 ===");
for (const element of slide.elements) {
  if (element.type === "text") {
    console.log(
      `TEXT  y=${(element.frame.y / height).toFixed(4)} h=${(element.frame.height / height).toFixed(4)} size=${element.style.fontSizePt} "${element.text.slice(0, 22)}"`,
    );
  } else if (element.type === "shape") {
    console.log(`SHAPE y=${(element.frame.y / height).toFixed(4)} h=${(element.frame.height / height).toFixed(4)} x=${(element.frame.x / document.pageSize.width).toFixed(3)}`);
  }
}

console.log("\n=== 列表行间距 ===");
const rows = slide.elements.filter((e) => e.type === "text" && /^\d\d$/.test(e.text));
for (let i = 1; i < rows.length; i += 1) {
  const gap = (rows[i]!.frame.y - rows[i - 1]!.frame.y) / height;
  console.log(`行${i} 间距 ${gap.toFixed(4)}`);
}

export type { PresentationDocument };

import { describe, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { applyCommand, type AiSlideDesign, type AiSlideDraft } from "../../core/commands";
import { createDocument } from "../../core/document-model";
import { buildPptx } from "./export-pptx";

const design = (layout: AiSlideDesign["layout"], background = "#FBFAF7", accent = "#2F6B5F"): AiSlideDesign => ({
  layout,
  background,
  accent,
  titleColor: "#1E2A32",
  bodyColor: "#3C4750",
});

const slides: AiSlideDraft[] = [
  { title: "岳阳楼记", body: "庆历六年，范仲淹记于邓州", speakerNotes: "" },
  { title: "一、由景及人", body: "登楼者不同，览物之情亦不同", speakerNotes: "" },
  {
    title: "一悲一喜，两境对照",
    body: "",
    speakerNotes: "",
    blocks: [{
      type: "comparison",
      leftLabel: "览阴而生悲",
      rightLabel: "览晴而生喜",
      leftItems: ["去国怀乡，忧谗畏讥", "满目萧然，感极而悲"],
      rightItems: ["心旷神怡，宠辱偕忘", "把酒临风，其喜洋洋"],
    }],
  },
  {
    title: "四条解读路径",
    body: "",
    speakerNotes: "",
    blocks: [{ type: "bullet-list", items: ["知人论世：生平与时代", "以意逆志：文本与心志", "内外互证：史实与细读", "贯通整合：形成能力"] }],
  },
  { title: "先天下之忧而忧，后天下之乐而乐", body: "范仲淹《岳阳楼记》", speakerNotes: "" },
  { title: "要点", body: "", speakerNotes: "", blocks: [{ type: "bullet-list", items: ["景：洞庭气象", "情：悲喜两境", "志：忧乐天下"] }] },
];

const designs: AiSlideDesign[] = [
  design("cover"),
  design("section"),
  design("split"),
  design("cards"),
  design("quote"),
  design("summary"),
];

describe("preset-only export", () => {
  it("exports a deck without a template", async () => {
    const document = createDocument();
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "岳阳楼记 教学课件",
      slides,
      designs,
      themePresetId: "paper-ink",
    });
    const result = await buildPptx(document);
    mkdirSync("D:/github/PPTD/.tmp/real", { recursive: true });
    writeFileSync("D:/github/PPTD/.tmp/real/preset-only.pptx", Buffer.from(result.bytes));
  });
});

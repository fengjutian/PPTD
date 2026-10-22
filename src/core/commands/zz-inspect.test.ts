import { describe, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";
import { createDocument } from "../document-model";

describe("inspect", () => {
  it("prints comparison geometry", () => {
    const source = createDocument();
    const content = {
      title: "迁客骚人的悲喜两类情感是文章由景及人的自然过渡",
      body: "",
      speakerNotes: "",
      blocks: [{
        type: "comparison" as const,
        leftLabel: "览阴而生悲",
        rightLabel: "览晴而生喜",
        leftItems: ["登斯楼，去国怀乡，忧谗畏讥", "满目萧然，感极而悲者矣"],
        rightItems: ["登斯楼，心旷神怡，宠辱偕忘", "把酒临风，其喜洋洋者矣"],
      }],
    };
    const design = { layout: "split" as const, background: "#FFFFFF", accent: "#0F7869", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "t", slides: [content], designs: [design] }));
    const w = result.pageSize.width, h = result.pageSize.height;
    for (const element of result.slides[0]!.elements) {
      const f = (v: number) => (v / (element.type === "text" ? h : h) * 100).toFixed(1);
      if (element.type === "text") console.log("TEXT", JSON.stringify(element.text.slice(0, 12)), element.style.fontSizePt + "pt", "x", (element.frame.x / w * 100).toFixed(1), "y", f(element.frame.y), "w", (element.frame.width / w * 100).toFixed(1), "h", f(element.frame.height));
      else if (element.type === "shape") console.log("SHAPE", "x", (element.frame.x / w * 100).toFixed(1), "y", f(element.frame.y), "w", (element.frame.width / w * 100).toFixed(1), "h", f(element.frame.height));
    }
  });
});

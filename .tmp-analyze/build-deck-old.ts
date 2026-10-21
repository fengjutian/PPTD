import { readFileSync, writeFileSync } from "node:fs";
import { applyCommand } from "../src/core/commands/commands-old";
import { createDocument } from "../src/core/document-model";
import { buildPptx } from "../src/features/pptx-export/export-pptx";

const layouts = JSON.parse(readFileSync(".tmp-analyze/real-layouts.json", "utf8"));
const probes = JSON.parse(readFileSync(".tmp-analyze/real-probes.json", "utf8"));
const width = layouts.slideWidthEmu;
const height = layouts.slideHeightEmu;

const theme = new Map<string, string>(layouts.theme);
const background = theme.get("lt1") ?? "#FFFFFF";
const foreground = theme.get("dk1") ?? "#1A1D23";
const accent = theme.get("accent1") ?? "#15A590";
const mix = (a: string, b: string, amount: number) => {
  const first = [a.slice(1, 3), a.slice(3, 5), a.slice(5, 7)].map((v) => parseInt(v, 16));
  const second = [b.slice(1, 3), b.slice(3, 5), b.slice(5, 7)].map((v) => parseInt(v, 16));
  return `#${first.map((c, i) => Math.round(c + (second[i]! - c) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};
const bodyForeground = mix(foreground, background, 0.22);

const dataUrl = (index: number) => `data:image/png;base64,${readFileSync(`.tmp-analyze/renders/layout${index}.png`).toString("base64")}`;

const templateLayouts = layouts.layouts.map((layout: any) => ({
  index: layout.index,
  name: layout.name,
  backgroundColor: undefined,
  backgroundImageDataUrl: dataUrl(layout.index),
  backgroundLuminance: probes[String(layout.index)],
  regions: layout.regions
    .filter((region: any) => region.role !== "image")
    .map((region: any) => ({
      role: region.role,
      frame: { x: region.x / width, y: region.y / height, width: region.width / width, height: region.height / height },
      textColor: region.textColor,
      fontSizePt: region.fontSizePt,
    })),
}));

const slides = [
  { title: "昆佰泰基因测序整体解决方案", body: "从样本前处理到生信报告的一站式交付能力", speakerNotes: "开场", plan: { visualIntent: "hero" } },
  { title: "精准医疗正在重塑临床决策", body: "肿瘤早筛覆盖率持续提升\n三代测序渗透率快速上升\n临床指南更新加快", speakerNotes: "市场", plan: { visualIntent: "structured-text" } },
  { title: "三年关键指标", body: "", speakerNotes: "指标", blocks: [{ type: "metric", label: "年检测样本量", value: "38万" }, { type: "metric", label: "合作医院", value: "260+" }, { type: "metric", label: "平均交付周期", value: "5天" }] },
  { title: "四大技术优势", body: "1. 自建测序平台，产能稳定\n2. 全流程质控，交付可靠\n3. 覆盖 200+ 癌种panel\n4. 生信团队驻场支持", speakerNotes: "优势", plan: { visualIntent: "summary" } },
  { title: "标准交付流程", body: "", speakerNotes: "流程", blocks: [{ type: "process", items: [{ label: "样本前处理", text: "48小时内完成建库" }, { label: "上机测序", text: "Illumina NovaSeq 平台" }, { label: "生信分析", text: "自动化流程与人工复核" }, { label: "报告交付", text: "临床级报告与解读" }] }] },
  { title: "两种合作模式对比", body: "", speakerNotes: "合作", blocks: [{ type: "comparison", leftLabel: "自建实验室", rightLabel: "委托检测", leftItems: ["长期成本更低", "数据完全自主", "需 6 个月建设期"], rightItems: ["启动快", "无需设备投入", "依赖外部排期"] }] },
  { title: "为什么选择昆佰泰", body: "从 2018 年至今，昆佰泰累计完成超过三百万例样本检测，服务网络覆盖全国二十六个省市。\n我们不只交付测序结果，而是交付可以直接进入临床决策的完整证据链。", speakerNotes: "总结", plan: { visualIntent: "structured-text" } },
];

const layoutByIntent: Record<string, string> = {
  hero: "cover",
  summary: "cards",
  "structured-text": "title-body",
  quote: "quote",
  timeline: "cards",
  comparison: "split",
  process: "cards",
  "data-chart": "title-body",
  "image-story": "split",
};
const intentLayout = slides.map((slide, index) => {
  const mapped = layoutByIntent[slide.plan.visualIntent] ?? "title-body";
  return index === 0 ? "cover" : mapped === "cover" ? "section" : mapped;
});
const designs = slides.map((slide, index) => ({
  layout: intentLayout[index] as any,
  background,
  accent,
  titleColor: foreground,
  bodyColor: bodyForeground,
}));

const document = createDocument();
applyCommand(document, {
  type: "apply-ai-designed-draft",
  title: "昆佰泰基因测序整体解决方案",
  slides: slides.map((slide) => ({ title: slide.title, body: slide.body, speakerNotes: slide.speakerNotes, blocks: (slide as any).blocks })),
  designs: designs as any,
  pageSize: { width: width as any, height: height as any },
  fontFamily: "Microsoft YaHei",
  templateLayouts: templateLayouts as any,
  backgroundRhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 },
});

writeFileSync(".tmp-analyze/deck-old.json", JSON.stringify(document, null, 1), "utf8");
document.slides.forEach((slide, index) => {
  const backgroundImage = slide.elements.find((element) => element.type === "image");
  const texts = slide.elements.filter((element) => element.type === "text");
  console.log(`--- page ${index + 1} layout=${designs[index]!.layout} bg=${backgroundImage ? "artwork" : "none"} elements=${slide.elements.length}`);
  texts.forEach((element) => {
    if (element.type === "text") {
      const frame = element.frame;
      console.log(`    "${element.text.slice(0, 18)}" @${(frame.x / width).toFixed(3)},${(frame.y / height).toFixed(3)} ${(frame.width / width).toFixed(3)}x${(frame.height / height).toFixed(3)} ${element.style.fontSizePt}pt ${element.style.color}`);
    }
  });
});

const { bytes, report } = await buildPptx(document, { fontAvailable: async () => true });
writeFileSync(".tmp-analyze/deck-old.pptx", bytes);
console.log(`pptx written: ${bytes.length} bytes, slides=${report.slideCount}, native=${report.nativeObjectCount}, package=${report.package.valid}`);

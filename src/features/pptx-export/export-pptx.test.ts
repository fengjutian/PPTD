import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { applyCommand } from "../../core/commands";
import { createDocument, emu, inches, type PresentationDocument } from "../../core/document-model";
import { buildPptx } from "./export-pptx";
import { validatePptxPackage } from "./pptx-package";

/**
 * A deck that was designed against a template: it carries the theme of the
 * template, one template layout and the artwork of that layout.
 */
function templateDocument(): PresentationDocument {
  const document = createDocument();
  const layoutId = crypto.randomUUID();
  document.theme = {
    name: "昆佰泰",
    majorFont: "Source Han Sans",
    minorFont: "Source Han Serif",
    colors: [{ name: "accent1", value: "#C04A32" }],
  };
  document.layouts = [{ id: layoutId, name: "内页（浅色）1", backgroundColor: "#ffffff" }];
  document.slides[0]!.layoutId = layoutId;
  document.slides[0]!.elements.unshift({
    id: crypto.randomUUID() as never,
    type: "image",
    placement: "layout-background",
    frame: { x: emu(0), y: emu(0), width: inches(13.333), height: inches(7.5) },
    rotationMilliDegree: 0,
    locked: true,
    source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
    altText: "模板版式背景",
  });
  return document;
}

describe("PPTX export", () => {
  it("creates a structurally valid ZIP-backed presentation and reports native objects", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-shape", slideId: document.slides[0]!.id, shape: "rectangle" });
    const result = await buildPptx(document);
    expect(String.fromCharCode(...result.bytes.slice(0, 2))).toBe("PK");
    expect(result.report.slideCount).toBe(1);
    expect(result.report.nativeObjectCount).toBe(2);
    expect(result.report.package.valid).toBe(true);
    expect(result.report.package.slideCount).toBe(1);
    expect(result.report.warnings.some((warning) => warning.includes("尚未完成审核"))).toBe(true);
  });

  it("honors an already-aborted export signal before building the package", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildPptx(createDocument(), { signal: controller.signal })).rejects.toThrow("EXPORT_CANCELLED");
  });

  it("exports embedded images as native picture objects", async () => {
    const document = createDocument();
    applyCommand(document, {
      type: "add-image",
      slideId: document.slides[0]!.id,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      altText: "sample",
    });
    const result = await buildPptx(document);
    expect(String.fromCharCode(...result.bytes.slice(0, 2))).toBe("PK");
    expect(result.report.nativeObjectCount).toBe(2);
    expect(result.report.package.valid).toBe(true);
  });

  it("writes the speaker notes into the notes page of the deck", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, { type: "set-speaker-notes", slideId, notes: "这一页先讲背景" });
    const result = await buildPptx(document);
    const files = unzipSync(result.bytes);
    // 备注写进 notesSlide，不只是留在文稿里。
    const notesFile = Object.keys(files).find((name) => name.startsWith("ppt/notesSlides/notesSlide"));
    expect(notesFile).toBeDefined();
    const notesXml = strFromU8(files[notesFile!]!);
    expect(notesXml).toContain("这一页先讲背景");
    expect(result.report.package.valid).toBe(true);
  });

  it("exports a line as a native line object with its arrow heads", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, { type: "add-line", slideId, direction: "diagonal" });
    const line = document.slides[0]!.elements.at(-1)!;
    if (line.type !== "line") throw new Error("expected a line");
    applyCommand(document, {
      type: "set-line-style",
      slideId,
      elementId: line.id,
      style: { stroke: "#3366CC", endArrow: "arrow", dashed: true },
    });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // A native line stays editable in PowerPoint: it is a connector shape, not
    // a picture of a line and not a flat rectangle.
    expect(slideXml).toContain("<a:prstGeom prst=\"line\">");
    expect(slideXml).toContain("3366CC");
    // 虚线和箭头都要真的写进 XML，不能只留在画布上。
    expect(slideXml).toContain('<a:prstDash val="dash"/>');
    expect(slideXml).toContain('<a:tailEnd type="arrow"/>');
    expect(result.report.package.valid).toBe(true);
  });

  it("writes the crop of a picture into the slide XML as a source rectangle", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, {
      type: "add-image",
      slideId,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      altText: "sample",
    });
    const image = document.slides[0]!.elements[1]!;
    applyCommand(document, {
      type: "set-image-crop",
      slideId,
      elementId: image.id,
      crop: { top: 0.1, bottom: 0.2, left: 0.15, right: 0 },
    });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain('<a:srcRect l="15000" t="10000" r="0" b="20000"/>');
    expect(result.report.croppedImages).toBe(1);
    expect(result.report.package.valid).toBe(true);
  });

  it("leaves a picture without a crop without a source rectangle", async () => {
    const document = createDocument();
    applyCommand(document, {
      type: "add-image",
      slideId: document.slides[0]!.id,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      altText: "sample",
    });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).not.toContain("<a:srcRect");
    expect(result.report.croppedImages).toBe(0);
  });

  it("preserves document z-order in the slide XML", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, { type: "add-shape", slideId, shape: "rectangle" });
    const shape = document.slides[0]!.elements[1]!;
    applyCommand(document, {
      type: "move-element",
      slideId,
      elementId: shape.id,
      x: shape.frame.x,
      y: (0.1 * 914_400) as typeof shape.frame.y,
    });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    const titleIndex = slideXml.indexOf("开始创造你的演示文稿");
    const shapeIndex = slideXml.indexOf("D35230");
    expect(titleIndex).toBeGreaterThan(-1);
    expect(shapeIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeLessThan(shapeIndex);
    expect((slideXml.match(/<p:sp>/g) ?? []).length).toBe(2);
  });

  it("warns about objects outside the page without changing the document", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const elementId = document.slides[0]!.elements[0]!.id;
    applyCommand(document, {
      type: "transform-element",
      slideId,
      elementId,
      frame: { x: inches(13), y: inches(1), width: inches(2), height: inches(1) },
      rotationMilliDegree: 0,
    });
    const before = JSON.stringify(document);
    const result = await buildPptx(document);
    expect(result.report.issues.some((issue) => issue.code === "out-of-bounds")).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects a package whose central directory is corrupted", () => {
    const bytes = new Uint8Array(64);
    expect(validatePptxPackage(bytes).valid).toBe(false);
  });

  it("writes the template layout as a slide master and keeps the artwork out of the page", async () => {
    const result = await buildPptx(templateDocument());
    const entries = unzipSync(result.bytes);
    const layoutEntries = Object.keys(entries).filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name));
    expect(layoutEntries.length).toBeGreaterThan(1);
    // The slide inherits the layout, it does not carry its own background.
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    expect(slideXml).not.toContain("<p:bg>");
    const slideRels = strFromU8(entries["ppt/slides/_rels/slide1.xml.rels"]!);
    const layoutTarget = /Target="\.\.\/slideLayouts\/(slideLayout\d+\.xml)"/.exec(slideRels)?.[1];
    expect(layoutTarget).toBeDefined();
    const layoutXml = strFromU8(entries[`ppt/slideLayouts/${layoutTarget}`]!);
    expect(layoutXml).toContain('name="内页（浅色）1"');
    // The artwork of the layout is the background of the layout.
    expect(layoutXml).toContain("<a:blipFill");
    expect(slideXml).not.toContain("<p:pic>");
    expect(result.report.masters).toContain("内页（浅色）1");
  });

  it("writes the theme of the template into the theme part of the package", async () => {
    const result = await buildPptx(templateDocument());
    const themeXml = strFromU8(unzipSync(result.bytes)["ppt/theme/theme1.xml"]!);
    expect(themeXml).toContain('<a:latin typeface="Source Han Sans"/>');
    expect(themeXml).toContain('<a:latin typeface="Source Han Serif"/>');
    expect(themeXml).toContain('<a:accent1><a:srgbClr val="C04A32"/></a:accent1>');
    expect(result.report.themeFonts).toEqual({ major: "Source Han Sans", minor: "Source Han Serif" });
    expect(result.report.themeColors).toEqual(["accent1"]);
  });

  it("keeps the page background on slides that were not designed against a template", async () => {
    const result = await buildPptx(createDocument());
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<p:bg>");
    expect(result.report.masters).toEqual([]);
  });

  it("names the parts of the package so that PowerPoint can open them", async () => {
    const result = await buildPptx(templateDocument());
    const entries = unzipSync(result.bytes);
    const media = Object.keys(entries).filter((name) => name.startsWith("ppt/media/") && !name.endsWith("/"));
    expect(media.length).toBeGreaterThan(0);
    // The name of a part is a URI segment. The layout of a Chinese template
    // produces a media name with Chinese characters, and PowerPoint refuses to
    // open the package with `0x808D1003`.
    expect(media.every((name) => /^[\x21-\x7e]+$/.test(name))).toBe(true);
    // The relationship of the layout has to point at the renamed part.
    const layoutRels = Object.keys(entries).find((name) => /^ppt\/slideLayouts\/_rels\/.+\.rels$/.test(name));
    expect(layoutRels).toBeDefined();
    const rels = strFromU8(entries[layoutRels!]!);
    expect(rels).not.toMatch(/Target="[^"]*[^\x00-\x7f]/);
    // The layout keeps the name of the template, it is only the part that is renamed.
    const layoutXml = Object.keys(entries)
      .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
      .map((name) => strFromU8(entries[name]!))
      .join("");
    expect(layoutXml).toContain('name="内页（浅色）1"');
  });

  it("writes a chart as a native chart object with the reviewed numbers", async () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    const first = { id: crypto.randomUUID(), type: "metric" as const, label: "样本量", value: "38万" };
    const second = { id: crypto.randomUUID(), type: "metric" as const, label: "覆盖机构", value: "12万" };
    document.slides[0]!.content.blocks = [first, second];
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "chart",
      contentBlockIds: [first.id, second.id],
      kind: "column",
      frame: { x: inches(1), y: inches(2), width: inches(8), height: inches(4) },
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        textColor: "#17181c",
        seriesColors: ["#3366CC"],
        showLegend: false,
        showValueLabels: true,
      },
    });
    const result = await buildPptx(document);
    const entries = unzipSync(result.bytes);
    const chartEntries = Object.keys(entries).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    // A native chart, not a picture of a chart: the data stays editable.
    expect(chartEntries).toHaveLength(1);
    const chartXml = strFromU8(entries[chartEntries[0]!]!);
    expect(chartXml).toContain("样本量");
    expect(chartXml).toContain("38");
    expect(chartXml).toContain("12");
    // The value keeps the unit of the reviewed number.
    expect(chartXml).toContain('formatCode="#,##0.##&quot;万&quot;"');
    expect(result.report.nativeObjectCount).toBe(2);
  });

  it("paints the chart area with the color of the page, so a dark page keeps no white block", async () => {
    const document = createDocument();
    document.slides[0]!.background = "#0E2A47";
    const metric = { id: crypto.randomUUID(), type: "metric" as const, label: "完成率", value: "62%" };
    document.slides[0]!.content.blocks = [metric];
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "chart",
      contentBlockIds: [metric.id],
      kind: "column",
      frame: { x: inches(1), y: inches(2), width: inches(8), height: inches(4) },
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        textColor: "#FFFFFF",
        seriesColors: ["#3366CC"],
        showLegend: false,
        showValueLabels: true,
      },
    });
    const result = await buildPptx(document);
    const entries = unzipSync(result.bytes);
    const chartEntries = Object.keys(entries).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    const chartXml = strFromU8(entries[chartEntries[0]!]!);
    // The chart area carries the color of the page. A white block on a dark
    // page would be a rectangle the editor never drew.
    expect(chartXml).toContain("0E2A47");
  });

  it("refuses to export a chart whose numbers are gone", async () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "chart",
      contentBlockIds: [crypto.randomUUID()],
      kind: "column",
      frame: { x: inches(1), y: inches(2), width: inches(8), height: inches(4) },
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        textColor: "#17181c",
        seriesColors: ["#3366CC"],
        showLegend: false,
        showValueLabels: true,
      },
    });
    await expect(buildPptx(document)).rejects.toThrow("EXPORT_VALIDATION_FAILED");
  });

  it("writes a table as a native table object with the reviewed cells", async () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    const block = {
      id: crypto.randomUUID(),
      type: "table-data" as const,
      header: ["项目", "数量"],
      rows: [
        ["样本量", "380000"],
        ["覆盖机构", "120000"],
      ],
    };
    document.slides[0]!.content.blocks = [block];
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "table",
      contentBlockId: block.id,
      frame: { x: inches(1), y: inches(2), width: inches(8), height: inches(3) },
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        headerFill: "#3366CC",
        headerTextColor: "#FFFFFF",
        bodyTextColor: "#17181c",
        borderColor: "#E2E7EC",
        firstColumnBold: true,
        bandingFill: "#F3F5F7",
        cellPaddingPt: 6,
        borderWidthPt: 0.75,
      },
    });
    const result = await buildPptx(document);
    const entries = unzipSync(result.bytes);
    // A native table, not a picture of a grid: the cells stay editable.
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<a:tbl>");
    expect(slideXml).toContain("项目");
    expect(slideXml).toContain("380000");
    expect(slideXml).toContain("120000");
    // Rows fill the element frame exactly instead of being clamped to 0.2–0.6in.
    const rowHeights = [...slideXml.matchAll(/<a:tr h="(\d+)"/g)].map((match) => Number(match[1]));
    expect(rowHeights).toHaveLength(3);
    expect(rowHeights.reduce((sum, height) => sum + height, 0)).toBe(inches(3));
    // The figure column is right-aligned and the alternate row carries the band.
    expect(slideXml).toContain('algn="r"');
    expect(slideXml.toUpperCase()).toContain("F3F5F7");
    expect(result.report.nativeTableCount).toBe(1);
    expect(result.report.package.valid).toBe(true);
  });

  it("refuses a table whose row is wider than its header", async () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    const block = {
      id: crypto.randomUUID(),
      type: "table-data" as const,
      header: ["项目", "数量"],
      rows: [["样本量", "380000", "多出来的一列"]],
    };
    document.slides[0]!.content.blocks = [block];
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "table",
      contentBlockId: block.id,
      frame: { x: inches(1), y: inches(2), width: inches(8), height: inches(3) },
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        headerFill: "#3366CC",
        headerTextColor: "#FFFFFF",
        bodyTextColor: "#17181c",
        borderColor: "#E2E7EC",
        firstColumnBold: true,
      },
    });
    // 多出来的单元格不能静默消失；导出前就拒绝，让用户去补表头或删列。
    await expect(buildPptx(document)).rejects.toThrow("EXPORT_VALIDATION_FAILED");
  });

  it("writes an emphasised text as real runs so the emphasis stays editable", async () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    const title = document.slides[0]!.elements[0]!;
    if (title.type !== "text") throw new Error("expected a text element");
    title.text = "覆盖机构：12万";
    title.runs = [{ start: 0, end: 4, bold: true }];
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // Two runs instead of one uniform run: the emphasis is a run of its own.
    expect((slideXml.match(/<a:r>/g) ?? []).length).toBe(2);
    expect(slideXml).toContain('b="1"');
    expect(slideXml).toContain("覆盖机构");
    expect(slideXml).toContain("：12万");
    expect(result.report.package.valid).toBe(true);
  });

  it("keeps a non-bold run inside a bold text element non-bold", async () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    const title = document.slides[0]!.elements[0]!;
    if (title.type !== "text") throw new Error("expected a text element");
    title.text = "普通加粗";
    title.style = { ...title.style, bold: true };
    title.runs = [{ start: 0, end: 2, bold: false }];
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // Only the explicitly bold run carries b="1"; the first run must not
    // inherit the element-level bold.
    expect((slideXml.match(/b="1"/g) ?? []).length).toBe(1);
  });

  it("refuses to export a table whose cells are gone", async () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "table",
      contentBlockId: crypto.randomUUID(),
      frame: { x: inches(1), y: inches(2), width: inches(8), height: inches(3) },
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        headerFill: "#3366CC",
        headerTextColor: "#FFFFFF",
        bodyTextColor: "#17181c",
        borderColor: "#E2E7EC",
        firstColumnBold: true,
      },
    });
    await expect(buildPptx(document)).rejects.toThrow("EXPORT_VALIDATION_FAILED");
  });

  it("writes tracking and leading of a text into the slide XML", async () => {
    const document = createDocument();
    const title = document.slides[0]!.elements[0]!;
    if (title.type !== "text") throw new Error("expected a text element");
    title.style.letterSpacingPt = 0.8;
    title.style.lineHeight = 1.3;
    const result = await buildPptx(document);
    const files = unzipSync(result.bytes);
    const xml = strFromU8(files["ppt/slides/slide1.xml"]!);
    expect(xml).toContain('spc="80"');
    expect(xml).toContain('spcPct val="130000"');
  });

  it("writes an icon as an svg picture", async () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "icon",
      name: "book",
      frame: { x: inches(1), y: inches(1), width: inches(1), height: inches(1) },
      rotationMilliDegree: 0,
      locked: false,
      style: { color: "#2F6B5F", strokeWidth: 2 },
    });
    const result = await buildPptx(document);
    const entries = unzipSync(result.bytes);
    const media = Object.keys(entries).filter((name) => name.endsWith(".svg"));
    expect(media.length).toBe(1);
    expect(strFromU8(entries[media[0]!]!)).toContain("viewBox=\"0 0 24 24\"");
  });
});
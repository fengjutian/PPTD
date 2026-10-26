import { describe, expect, it } from "vitest";
import type { ElementId, Emu } from "../../core/document-model";
import { strFromU8, unzipSync } from "fflate";
import { applyCommand } from "../../core/commands";
import { createDocument, emu, inches, pageSizeFromInches, type PresentationDocument } from "../../core/document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../../core/design/deck-concept";
import { buildSpecimenDocument } from "../../services/theme-specimen";
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
  it("reports template adherence at export when a target is persisted", async () => {
    const document = templateDocument();
    const title = document.slides[0]!.elements.find(
      (element) => element.type === "text" && element.contentRef === "title",
    )!;
    const width = document.pageSize.width;
    const height = document.pageSize.height;
    const grid = {
      left: title.frame.x / width,
      right: (title.frame.x + title.frame.width) / width,
      top: title.frame.y / height,
      bottom: (title.frame.y + title.frame.height) / height,
      titleX: title.frame.x / width,
      titleY: title.frame.y / height,
      titleWidth: title.frame.width / width,
      titleHeight: title.frame.height / height,
      bodyTop: title.frame.y / height,
      bodyBottom: (title.frame.y + title.frame.height) / height,
    };
    document.templateStyle = {
      name: document.theme!.name,
      page: { widthEmu: width, heightEmu: height },
      grid,
      layouts: [
        {
          name: document.layouts![0]!.name,
          grid,
          titleSizePt: title.type === "text" ? title.style.fontSizePt : undefined,
          freeComposition: false,
        },
      ],
      palette: [],
      alignment: "left-grid",
      confidence: "high",
      minimumFit: 90,
      tolerances: { axis: 0.01, axisY: 0.005, margin: 0.01, fontSizePt: 1.5, colorChannel: 12 },
    };
    const result = await buildPptx(document);
    expect(result.report.templateFit).toMatchObject({ checked: true, passed: true });
    expect(result.report.templateFit?.score).toBeGreaterThanOrEqual(90);
    // Every measured page resolved to the template's own layout.
    expect(result.report.templateFit?.checkedSlides).toBe(1);
    expect(result.report.templateFit?.layoutCoverage).toBe(1);
    expect(result.report.designAudit.layouts[0]).toMatchObject({ name: document.layouts![0]!.name, usedBySlides: 1 });
    expect(result.report.designAudit.versions.schema).toBe(document.schemaVersion);
    expect(result.report.warnings.some((warning) => warning.includes("没有匹配的模板版式"))).toBe(false);

    // The same deck with its layout bindings removed. With two layouts in the
    // target there is no single-layout fallback, so no page can resolve one:
    // the report has to say so instead of leaving a silently free-composed page
    // in a deck that claims template adherence.
    const detached = templateDocument();
    const firstLayout = document.templateStyle!.layouts[0]!;
    detached.templateStyle = {
      ...document.templateStyle!,
      layouts: [firstLayout, { ...firstLayout, name: "另一个版式" }],
    };
    for (const slide of detached.slides) slide.layoutId = undefined;
    const second = await buildPptx(detached, { prevalidatedIssues: [] });
    expect(second.report.templateFit?.checkedSlides).toBe(1);
    expect(second.report.templateFit?.layoutCoverage).toBe(0);
    expect(second.report.warnings.some((warning) => warning.includes("没有匹配的模板版式"))).toBe(true);
  });

  it("writes editor groups as native PowerPoint groups", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    const elementIds = [slide.elements[0]!.id, slide.elements[2]!.id];
    applyCommand(document, { type: "group-elements", slideId: slide.id, elementIds });
    const result = await buildPptx(document);

    expect(result.report.nativeGroupCount).toBe(1);
    expect(result.report.nativeGroupSkipped).toBe(0);
    expect(result.report.warnings.some((warning) => warning.includes("分组"))).toBe(false);
    expect(result.report.package.valid).toBe(true);

    const xml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    const groupStart = xml.indexOf("<p:grpSp>");
    expect(groupStart).toBeGreaterThan(-1);
    expect(xml.indexOf(`name="${elementIds[0]}"`)).toBeGreaterThan(groupStart);
    expect(xml.indexOf(`name="${elementIds[1]}"`)).toBeGreaterThan(groupStart);
    expect((xml.match(/<p:grpSp>/g) ?? []).length).toBe(1);
  });

  it("keeps a group containing a table flat and reports why", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 2, rows: 2 });
    const table = slide.elements.find((element) => element.type === "table");
    if (!table) throw new Error("expected table");
    applyCommand(document, {
      type: "group-elements",
      slideId: slide.id,
      elementIds: [slide.elements[0]!.id, table.id],
    });
    const result = await buildPptx(document);

    expect(result.report.nativeGroupCount).toBe(0);
    expect(result.report.nativeGroupSkipped).toBe(1);
    expect(result.report.warnings.some((warning) => warning.includes("表格"))).toBe(true);
    const xml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(xml).not.toContain("<p:grpSp>");
    expect(result.report.package.valid).toBe(true);
  });

  it("groups a chart with a text box by its stable object name", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-chart", slideId: slide.id, kind: "column" });
    const chart = slide.elements.find((element) => element.type === "chart");
    if (!chart) throw new Error("expected chart");
    applyCommand(document, {
      type: "group-elements",
      slideId: slide.id,
      elementIds: [slide.elements[0]!.id, chart.id],
    });
    const result = await buildPptx(document);

    expect(result.report.nativeGroupCount).toBe(1);
    expect(result.report.nativeGroupSkipped).toBe(0);
    const xml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    const groupStart = xml.indexOf("<p:grpSp>");
    expect(groupStart).toBeGreaterThan(-1);
    expect(xml.indexOf(`name="${chart.id}"`)).toBeGreaterThan(groupStart);
    expect(xml.indexOf("<p:graphicFrame>")).toBeGreaterThan(groupStart);
  });

  it("reports taste findings without failing the export", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const body = slide.elements[slide.elements.length - 1]!;
    applyCommand(document, {
      type: "edit-text",
      slideId: slide.id,
      elementId: body.id,
      text: "这是一段用于触发正文字号下限的测试文本，长度需要超过四十个字符，否则它会被当成注释而不是正文。",
    });
    applyCommand(document, {
      type: "set-text-style",
      slideId: slide.id,
      elementId: body.id,
      style: { fontSizePt: 8 },
    });
    const result = await buildPptx(document);
    expect(result.report.tasteLint?.hard).toBe(1);
    expect(result.report.tasteLint?.codes.BODY_TEXT_TOO_SMALL).toBe(1);
    expect(result.report.package.valid).toBe(true);
  });

  it("omits taste findings when the check is disabled", async () => {
    const document = createDocument();
    const result = await buildPptx(document, { tasteLint: false });
    expect(result.report.tasteLint).toBeUndefined();
  });

  it("reports the provenance status of pictures", async () => {
    const document = buildSpecimenDocument();
    const slide = document.slides.find((candidate) =>
      candidate.elements.some((element) => element.type === "image" && element.placement === "content"),
    )!;
    const image = slide.elements.find((element) => element.type === "image" && element.placement === "content")!;
    applyCommand(document, {
      type: "set-image-provenance",
      slideId: slide.id,
      elementId: image.id,
      provenance: { verification: "verified", sourceUrl: "https://example.com/photo", license: "CC BY 4.0" },
    });
    const result = await buildPptx(document);
    expect(result.report.assetProvenance).toEqual({ verified: 1, pending: 0, user: 0, missing: 0 });
  });

  it("writes a native gradient into the slide part, not an image", async () => {
    const document = buildSpecimenDocument();
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<a:gradFill");
    expect(slideXml).toContain('<a:lin ang="2700000"');
    expect(result.report.warnings.some((warning) => warning.includes("渐变"))).toBe(false);
    expect(result.report.package.valid).toBe(true);
  });

  it("writes a changed page size into the presentation part", async () => {
    const document = createDocument();
    applyCommand(document, { type: "set-page-size", pageSize: pageSizeFromInches(10, 7.5)! });
    const result = await buildPptx(document);
    const presentationXml = strFromU8(unzipSync(result.bytes)["ppt/presentation.xml"]!);
    // 10in × 7.5in in EMU: the deck is a standard 4:3 page after the change.
    expect(presentationXml).toContain('cx="9144000"');
    expect(presentationXml).toContain('cy="6858000"');
  });

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

  it("writes a supported object animation into a native timing tree", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId: slide.elements[0]!.id,
      animation: { effect: "fade", start: "on-click", durationMs: 500, delayMs: 0, direction: "none" },
    });

    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);

    expect(slideXml).toContain("<p:timing>");
    expect(slideXml).toContain('<p:animEffect transition="in" filter="fade">');
    expect(slideXml).toContain("<p:bldLst>");
    expect(result.report.nativeAnimationCount).toBe(1);
    expect(result.report.nativeAnimationSkipped).toBe(0);
    expect(result.report.issues.some((issue) => issue.code === "animation-not-exported")).toBe(false);
  });

  it("reports chart animations as not natively exported", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-chart", slideId: slide.id, kind: "column" });
    const chart = slide.elements.find((element) => element.type === "chart");
    if (!chart) throw new Error("expected chart");
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId: chart.id,
      animation: { effect: "fade", start: "on-click", durationMs: 500, delayMs: 0, direction: "none" },
    });

    const result = await buildPptx(document);

    expect(result.report.nativeAnimationCount).toBe(0);
    expect(result.report.nativeAnimationSkipped).toBe(1);
    expect(result.report.warnings.some((warning) => warning.includes("未写入 PPTX"))).toBe(true);
  });

  it("writes split, float-in, pulse and disappear as native effects", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    for (let index = 0; index < 4; index += 1) {
      applyCommand(document, { type: "add-text", slideId: slide.id });
    }
    const effects = ["split", "float-in", "pulse", "disappear"] as const;
    effects.forEach((effect, index) => {
      applyCommand(document, {
        type: "add-animation",
        slideId: slide.id,
        elementId: slide.elements[index]!.id,
        animation: { effect, start: "on-click", durationMs: 600, delayMs: 0, direction: "none" },
      });
    });

    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);

    expect(result.report.nativeAnimationCount).toBe(4);
    expect(result.report.nativeAnimationSkipped).toBe(0);
    expect(slideXml).toContain("barn(inVertical)");
    expect(slideXml).toContain('presetID="30"');
    expect(slideXml).toContain("ppt_y+0.25");
    expect(slideXml).toContain("<p:animScale>");
    expect(slideXml).toContain('presetClass="exit"');
    expect(slideXml).toContain('<p:strVal val="hidden"/>');
  });

  it("writes merged table cells as native grid spans", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 3, rows: 2 });
    const block = slide.content.blocks!.find((candidate) => candidate.type === "table-data");
    if (block?.type !== "table-data") throw new Error("expected table block");
    block.merges = [{ section: "body", row: 0, column: 0, rowSpan: 1, columnSpan: 2 }];
    block.rows[0]![0] = "合并";
    block.rows[0]![1] = "";

    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toMatch(/gridSpan="2"/);
    expect(result.report.package.valid).toBe(true);
  });

  it("clips a picture into a native geometry and keeps its crop, rotation and alt text", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.elements.push({
      id: "22222222-2222-4222-8222-222222222222" as ElementId,
      type: "image",
      frame: { x: 0 as Emu, y: 0 as Emu, width: 2_000_000 as Emu, height: 2_000_000 as Emu },
      rotationMilliDegree: 45_000,
      locked: false,
      origin: "user",
      source: {
        kind: "embedded",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
      altText: "圆形头像",
      crop: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
      frameShape: "ellipse",
    });
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // A shape filled with the picture, not a picture in a rectangular frame.
    expect(slideXml).toContain('prst="ellipse"');
    expect(slideXml).toContain("<a:blipFill>");
    // The crop is applied inside the fill; without it the picture stretches.
    expect(slideXml).toContain("<a:srcRect");
    // The parts a screenshot cannot show: the description and the rotation.
    expect(slideXml).toContain('descr="圆形头像"');
    // DrawingML stores rotation in 1/60000°, so the attribute is not the 45 the
    // page holds; what matters is that the rewrite carried it across at all.
    expect(slideXml).toMatch(/<a:xfrm[^>]*\brot="\d+"/);
    expect(result.report.package.valid).toBe(true);
  });

  it("writes a picture tone as a native duotone effect", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.background = "#12233d";
    slide.elements.push({
      id: "44444444-4444-4444-8444-444444444444" as ElementId,
      type: "image",
      frame: { x: 0 as Emu, y: 0 as Emu, width: 8_000_000 as Emu, height: 6_000_000 as Emu },
      rotationMilliDegree: 0,
      locked: false,
      source: {
        kind: "embedded",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
      altText: "深色页全幅照片",
      placement: "content",
      // A tone and a shape together: the shaped path rebuilds the blip, and the
      // effect has to survive that rebuild.
      frameShape: "roundRect",
      tone: { dark: "#0F7869", light: "#E4F2EE" },
    });
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // A native effect on the picture, not a recoloured copy of its pixels: the
    // photograph stays replaceable in PowerPoint.
    expect(slideXml).toContain("<a:duotone>");
    expect(slideXml).toContain('<a:srgbClr val="0F7869"/>');
    expect(slideXml).toContain('<a:srgbClr val="E4F2EE"/>');
    expect(slideXml).toContain('prst="roundRect"');
    expect(result.report.package.valid).toBe(true);
  });

  it("leaves a picture without a frame shape as a picture", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.elements.push({
      id: "33333333-3333-4333-8333-333333333333" as ElementId,
      type: "image",
      frame: { x: 0 as Emu, y: 0 as Emu, width: 1_000_000 as Emu, height: 1_000_000 as Emu },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      source: {
        kind: "embedded",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
      altText: "方形照片",
    });
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<p:pic>");
    // No shape crop: the page keeps an ordinary picture.
    expect(slideXml).not.toContain('prst="ellipse"');
  });

  it("writes a preset shape as native PowerPoint geometry", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-shape", slideId: document.slides[0]!.id, shape: "triangle" });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain('prst="triangle"');
    expect(result.report.package.valid).toBe(true);
  });

  it("writes a shadow token as a native outer shadow", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    const shape = slide.elements.find((element) => element.type === "shape");
    expect(shape?.type).toBe("shape");
    if (shape?.type !== "shape") return;
    shape.style = { ...shape.style, shadow: "raised", radiusPt: 8 };
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // The effect is an OOXML effect list on the shape, not a picture of a shadow.
    expect(slideXml).toContain("<a:effectLst>");
    expect(slideXml).toContain("<a:outerShdw");
    expect(slideXml).toContain('prst="roundRect"');
    expect(result.report.package.valid).toBe(true);
  });

  it("leaves a shape without a token flat", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-shape", slideId: document.slides[0]!.id, shape: "rectangle" });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).not.toContain("<a:outerShdw");
  });

  it("writes a page transition as a native PowerPoint transition", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, {
      type: "set-slide-transition",
      slideId: slide.id,
      transition: { kind: "push", speed: "medium", direction: "left" },
    });

    const result = await buildPptx(document);
    const files = unzipSync(result.bytes);
    const slideXml = strFromU8(files["ppt/slides/slide1.xml"]!);

    expect(slideXml).toContain('<p:transition spd="med"><p:push dir="l"/></p:transition>');
    expect(result.report.nativeTransitionCount).toBe(1);
    expect(result.report.package.valid).toBe(true);
  });

  it("links object colors to theme slots so a theme edit recolors them", async () => {
    const document = createDocument();
    document.theme = {
      name: "品牌主题",
      majorFont: "Arial",
      minorFont: "Arial",
      colors: [{ name: "accent", value: "#C04A32" }],
    };
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    const shape = slide.elements.find((element) => element.type === "shape");
    if (shape?.type !== "shape") throw new Error("expected shape");
    shape.style.fill = "#C04A32";
    shape.style.stroke = "#C04A32";

    const result = await buildPptx(document);
    const files = unzipSync(result.bytes);
    const slideXml = strFromU8(files["ppt/slides/slide1.xml"]!);
    const themeXml = strFromU8(files["ppt/theme/theme1.xml"]!);

    expect(slideXml).toContain('<a:schemeClr val="accent1"/>');
    expect(slideXml).not.toContain("C04A32");
    expect(themeXml).toContain("C04A32");
    expect(result.report.themeColors).toContain("accent1");
    expect(result.report.themeColorReferences).toBeGreaterThanOrEqual(2);
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

  it("writes character and paragraph formatting as native text properties", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, {
      type: "set-text-style",
      slideId: slide.id,
      elementId: slide.elements[0]!.id,
      style: {
        italic: true,
        underline: true,
        strikethrough: true,
        verticalAlign: "middle",
        bullet: "number",
        indentLevel: 2,
        lineHeight: 1.5,
        paragraphSpaceBeforePt: 6,
        paragraphSpaceAfterPt: 9,
        tabStops: [
          { positionPt: 72, alignment: "center" },
          { positionPt: 144, alignment: "decimal" },
        ],
      },
    });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // These are native run/paragraph properties, not a picture of styled text.
    expect(slideXml).toContain('i="1"');
    expect(slideXml).toContain('u="sng"');
    expect(slideXml).toContain('strike="sngStrike"');
    expect(slideXml).toContain('anchor="ctr"');
    expect(slideXml).toContain("<a:buAutoNum");
    expect(slideXml).toContain('lvl="2"');
    expect(slideXml).toContain("<a:spcPct");
    expect(slideXml).toContain('<a:spcBef><a:spcPts val="600"/></a:spcBef>');
    expect(slideXml).toContain('<a:spcAft><a:spcPts val="900"/></a:spcAft>');
    expect(slideXml).toContain('<a:tab pos="914400" algn="ctr"/>');
    expect(slideXml).toContain('<a:tab pos="1828800" algn="dec"/>');
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
    expect(slideXml).toContain('<a:prstGeom prst="line">');
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

  it("exports a template recipe page as native text and keeps the artwork on the master", async () => {
    const document = createDocument();
    const items = ["肿瘤早筛覆盖率提升", "三代测序渗透率上升", "临床指南更新加快"];
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 3,
          shortItems: true,
          longestItemLength: 12,
          bodyLength: 40,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "title-body",
        },
      ],
      pageCount: 1,
      id: "export-template-recipe",
    }).concept;
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "模板配方",
      slides: [{ title: "精准医疗重塑临床决策", body: items.join("\n"), speakerNotes: "" }],
      designs: [
        {
          layout: "title-body",
          background: "#FFFFFF",
          accent: "#3366CC",
          titleColor: "#273D79",
          bodyColor: "#4C4C4C",
        },
      ],
      designConcept: concept,
      templateLayouts: [
        {
          index: 1,
          name: "内页（浅色）",
          backgroundImageDataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
          regions: [
            { role: "title", frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
            { role: "body", frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
          ],
        },
      ],
    });
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const entries = unzipSync(result.bytes);
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("01");
    expect(slideXml).toContain(items[0]!);
    // The artwork stays on the slide master; the recipe text is native.
    expect(slideXml).not.toContain("<p:pic>");
    expect(result.report.package.valid).toBe(true);
    expect(result.report.nativeObjectCount).toBeGreaterThanOrEqual(5);
    expect(result.report.masters).toContain("内页（浅色）");
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
    expect(chartXml).toContain('formatCode="#,##0&quot;万&quot;"');
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

  it("warns when a chart palette would merge into the page", async () => {
    const document = createDocument();
    document.slides[0]!.background = "#12233D";
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
        // The page's own colour as the series colour: a chart nobody can read.
        seriesColors: ["#12233D"],
        showLegend: false,
        showValueLabels: true,
      },
    });
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    expect(result.report.warnings.some((warning) => warning.includes("对比不足"))).toBe(true);
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

  it("exports a manually inserted table and chart as native objects", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, { type: "add-table", slideId, columns: 3, rows: 2 });
    applyCommand(document, { type: "add-chart", slideId, kind: "column" });
    const result = await buildPptx(document);
    const entries = unzipSync(result.bytes);
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<a:tbl>");
    expect(Object.keys(entries).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toHaveLength(1);
    expect(result.report.nativeTableCount).toBe(1);
    expect(result.report.nativeChartCount).toBe(1);
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

  it("writes an icon as a native custom-geometry shape", async () => {
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
    // An icon must not become a picture: PptxGenJS's SVG preview is written as
    // an invalid PNG fallback, and PowerPoint refuses the whole package.
    expect(Object.keys(entries).filter((name) => name.startsWith("ppt/media/") && !name.endsWith("/"))).toEqual([]);
    const xml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    expect(xml).toContain("<a:custGeom>");
    expect(xml).toContain("<a:path ");
    expect(xml).toContain("<a:noFill/>");
    expect(xml).toContain('val="2F6B5F"');
    expect(xml).not.toContain("<p:pic>");
    expect(xml).not.toContain(".svg");
  });

  it("leaves a hidden object out of the package and says so", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "approved";
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "ellipse" });
    const visibleShape = slide.elements[1]!;
    const hiddenShape = slide.elements[2]!;
    hiddenShape.hidden = true;
    hiddenShape.name = "草稿底板";

    const result = await buildPptx(document);
    const xml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(xml).toContain(`name="${visibleShape.id}"`);
    expect(xml).not.toContain(`name="${hiddenShape.id}"`);
    expect(xml).not.toContain("草稿底板");
    expect(result.report.nativeObjectCount).toBe(2);
    expect(result.report.warnings.some((warning) => warning.includes("隐藏对象"))).toBe(true);
  });

  it("exports a text-run hyperlink as an external editable relationship", async () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("TEXT_EXPECTED");
    element.text = "Open report";
    element.runs = [{ start: 0, end: 11, hyperlinkUrl: "https://example.com/report?id=7" }];

    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const entries = unzipSync(result.bytes);
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    const relsXml = strFromU8(entries["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(slideXml).toContain("<a:hlinkClick");
    expect(relsXml).toContain('TargetMode="External"');
    expect(relsXml).toContain("https://example.com/report?id=7");
  });

  it("exports a partial text hyperlink without linking the rest of the box", async () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("TEXT_EXPECTED");
    element.text = "Open report now";
    element.runs = [{ start: 0, end: 4, hyperlinkUrl: "https://example.com/open" }];

    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const entries = unzipSync(result.bytes);
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    const relsXml = strFromU8(entries["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(slideXml.match(/<a:hlinkClick/g)).toHaveLength(1);
    expect(slideXml).toContain("Open");
    expect(slideXml).toContain("report now");
    expect(relsXml).toContain("https://example.com/open");
  });
});

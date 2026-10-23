import { describe, expect, it } from "vitest";
import { applyCommand, commandDomain } from "./commands";
import {
  captureContentVersion,
  createDocument,
  createSlide,
  inches,
  type ContentBlock,
  type ElementId,
  type PresentationDocument,
  type Slide,
} from "../document-model";

function metric(value: string): ContentBlock {
  return { id: crypto.randomUUID(), type: "metric", label: "收入", value };
}

function twoPageDocument(): { document: PresentationDocument; first: Slide; second: Slide; versionId: string } {
  const document = createDocument();
  document.slides.push(createSlide(2));
  const first = document.slides[0]!;
  const second = document.slides[1]!;
  first.content.title = "旧标题";
  first.content.body = "旧正文";
  first.content.speakerNotes = "旧备注";
  first.content.blocks = [metric("38万")];
  first.content.status = "approved";
  second.content.title = "第二页";
  second.content.status = "approved";
  captureContentVersion(document);
  return { document, first, second, versionId: document.contentVersions![0]!.id };
}

describe("restoring a content version", () => {
  it("restores text, blocks, notes and page order without touching design", () => {
    const { document, first, second, versionId } = twoPageDocument();
    const shapeCount = first.elements.length;
    applyCommand(document, { type: "add-shape", slideId: first.id, shape: "rectangle" });

    first.content.title = "新标题";
    first.content.body = "新正文";
    first.content.speakerNotes = "新备注";
    (first.content.blocks![0] as Extract<ContentBlock, { type: "metric" }>).value = "42万";
    first.content.status = "approved";
    second.content.status = "approved";
    document.slides.reverse();

    applyCommand(document, { type: "restore-content-version", versionId });

    expect(document.slides[0]!.id).toBe(first.id);
    expect(document.slides[1]!.id).toBe(second.id);
    expect(first.content.title).toBe("旧标题");
    expect(first.content.body).toBe("旧正文");
    expect(first.content.speakerNotes).toBe("旧备注");
    expect((first.content.blocks![0] as Extract<ContentBlock, { type: "metric" }>).value).toBe("38万");
    // 内容被恢复，按内容域规则需要重新确认。
    expect(first.content.status).toBe("changed");
    // 恢复只动内容：版本之后加的形状还在。
    expect(first.elements.length).toBe(shapeCount + 1);
    expect(first.elements.some((element) => element.type === "shape")).toBe(true);
  });

  it("keeps current block ids, remaps stale card references and updates their text", () => {
    const { document, first, versionId } = twoPageDocument();
    const versionBlockId = document.contentVersions![0]!.slides[0]!.blocks![0]!.id;
    const currentBlockId = crypto.randomUUID();
    first.content.blocks = [{ id: currentBlockId, type: "metric", label: "收入", value: "42万" }];
    const cardId = crypto.randomUUID() as ElementId;
    first.elements.push({
      id: cardId,
      type: "text",
      contentRef: "decorative",
      text: "42万",
      frame: { x: inches(1), y: inches(1), width: inches(2), height: inches(0.5) },
      rotationMilliDegree: 0,
      locked: false,
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 16, color: "#333333", bold: false, align: "left" },
      // 设计换版后卡片可能还指着快照里的旧块 id。
      contentBlockRef: { blockId: versionBlockId, field: "value" },
    });

    applyCommand(document, { type: "restore-content-version", versionId });

    // 块 id 不变，图表/表格/卡片的绑定才不会悬空。
    expect(first.content.blocks![0]!.id).toBe(currentBlockId);
    expect((first.content.blocks![0] as Extract<ContentBlock, { type: "metric" }>).value).toBe("38万");
    const card = first.elements.find((element) => element.id === cardId);
    expect(card?.type === "text" ? card.contentBlockRef?.blockId : undefined).toBe(currentBlockId);
    expect(card?.type === "text" ? card.text : undefined).toBe("38万");
  });

  it("restores the order of content blocks", () => {
    const document = createDocument();
    const first = metric("38万");
    const second = metric("42万");
    document.slides[0]!.content.blocks = [first, second];
    captureContentVersion(document);
    const versionId = document.contentVersions![0]!.id;
    document.slides[0]!.content.blocks = [second, first];

    expect(commandDomain({ type: "restore-content-version", versionId }, document)).toBe("content");
    applyCommand(document, { type: "restore-content-version", versionId });

    expect(document.slides[0]!.content.blocks!.map((block) => block.id)).toEqual([first.id, second.id]);
    expect(
      document.slides[0]!.content.blocks!.map((block) => (block.type === "metric" ? block.value : undefined)),
    ).toEqual(["38万", "42万"]);
  });

  it("is a no-op for the version that already matches the current copy", () => {
    const { document, versionId } = twoPageDocument();
    expect(commandDomain({ type: "restore-content-version", versionId }, document)).toBeNull();
  });

  it("refuses a version whose page set differs from the current deck", () => {
    const { document, versionId } = twoPageDocument();
    document.slides.push(createSlide(3));
    expect(() => applyCommand(document, { type: "restore-content-version", versionId })).toThrow(
      "CONTENT_VERSION_PAGE_SET_MISMATCH",
    );
  });

  it("refuses when the block structure cannot be restored without dangling references", () => {
    const { document, first, versionId } = twoPageDocument();
    first.content.blocks = [{ id: crypto.randomUUID(), type: "paragraph", text: "换了块类型" }];
    expect(() => applyCommand(document, { type: "restore-content-version", versionId })).toThrow(
      "CONTENT_VERSION_BLOCKS_INCOMPATIBLE",
    );
  });

  it("reports an unknown version instead of doing nothing", () => {
    const document = createDocument();
    expect(() => applyCommand(document, { type: "restore-content-version", versionId: "missing" })).toThrow(
      "CONTENT_VERSION_NOT_FOUND",
    );
  });
});

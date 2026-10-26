import { describe, expect, it } from "vitest";
import {
  createDocument,
  type ElementId,
  type RectEmu,
  type SlideElement,
  type SlideGroup,
} from "../../core/document-model";
import { patchGroupsInSlideXml } from "./group-xml";

function frame(x: number, y: number, width: number, height: number): RectEmu {
  return { x, y, width, height };
}

function element(id: string, bounds: RectEmu, rotationMilliDegree = 0): SlideElement {
  const base = createDocument().slides[0]!.elements[0]!;
  return { ...base, id: id as ElementId, frame: bounds, rotationMilliDegree };
}

function group(id: string, elementIds: string[]): SlideGroup {
  return { id, elementIds: elementIds as ElementId[] };
}

function shapeXml(name: string, id: number, bounds: RectEmu): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${bounds.x}" y="${bounds.y}"/><a:ext cx="${bounds.width}" cy="${bounds.height}"/></a:xfrm></p:spPr><p:txBody><a:p/></p:txBody></p:sp>`;
}

function tableXml(name: string, id: number, bounds: RectEmu): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${bounds.x}" y="${bounds.y}"/><a:ext cx="${bounds.width}" cy="${bounds.height}"/></p:xfrm><a:graphic/></p:graphicFrame>`;
}

function slideXml(...blocks: string[]): string {
  return `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${blocks.join("")}</p:spTree></p:cSld></p:sld>`;
}

describe("native group XML", () => {
  it("wraps two named shapes in a group with an identity child coordinate system", () => {
    const xml = slideXml(
      shapeXml("a", 2, frame(0, 0, 100, 100)),
      shapeXml("b", 3, frame(200, 50, 70, 60)),
    );
    const result = patchGroupsInSlideXml(xml, {
      elements: [element("a", frame(0, 0, 100, 100)), element("b", frame(200, 50, 70, 60))],
      groups: [group("g1", ["a", "b"])],
    });

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.xml).toContain('<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group g1"/>');
    expect(result.xml).toContain(
      '<a:off x="0" y="0"/><a:ext cx="270" cy="110"/><a:chOff x="0" y="0"/><a:chExt cx="270" cy="110"/>',
    );
    expect(result.xml.indexOf('name="a"')).toBeGreaterThan(result.xml.indexOf("<p:grpSp>"));
    expect(result.xml.indexOf('name="b"')).toBeGreaterThan(result.xml.indexOf('name="a"'));
    expect((result.xml.match(/<p:sp>/g) ?? []).length).toBe(2);
    expect((result.xml.match(/<\/p:sp>/g) ?? []).length).toBe(2);
  });

  it("places the group at the front-most member and keeps the member z-order", () => {
    const xml = slideXml(
      shapeXml("a", 2, frame(0, 0, 100, 100)),
      shapeXml("b", 3, frame(200, 0, 100, 100)),
      shapeXml("c", 4, frame(400, 0, 100, 100)),
    );
    const result = patchGroupsInSlideXml(xml, {
      elements: [
        element("a", frame(0, 0, 100, 100)),
        element("b", frame(200, 0, 100, 100)),
        element("c", frame(400, 0, 100, 100)),
      ],
      groups: [group("front", ["a", "c"])],
    });

    expect(result.written).toBe(1);
    // a and c were separated by b. The group takes c's (the front-most
    // member's) place, so b stays below it.
    expect(result.xml.indexOf('name="b"')).toBeLessThan(result.xml.indexOf("<p:grpSp>"));
    expect(result.xml.indexOf('name="a"')).toBeGreaterThan(result.xml.indexOf("<p:grpSp>"));
    expect(result.xml.indexOf('name="c"')).toBeGreaterThan(result.xml.indexOf('name="a"'));
  });

  it("keeps a group with a table flattened because PowerPoint forbids grouping tables", () => {
    const xml = slideXml(
      shapeXml("a", 2, frame(0, 0, 100, 100)),
      tableXml("t", 3, frame(200, 0, 100, 100)),
    );
    const result = patchGroupsInSlideXml(xml, {
      elements: [element("a", frame(0, 0, 100, 100)), element("t", frame(200, 0, 100, 100))],
      groups: [group("mixed", ["a", "t"])],
    });

    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.xml).toBe(xml);
    expect(result.xml).not.toContain("<p:grpSp>");
  });

  it("reports a group whose member could not be found", () => {
    const xml = slideXml(shapeXml("a", 2, frame(0, 0, 100, 100)));
    const result = patchGroupsInSlideXml(xml, {
      elements: [element("a", frame(0, 0, 100, 100))],
      groups: [group("missing", ["a", "gone"])],
    });

    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.xml).toBe(xml);
  });

  it("wraps multiple independent groups", () => {
    const xml = slideXml(
      shapeXml("a", 2, frame(0, 0, 100, 100)),
      shapeXml("b", 3, frame(120, 0, 100, 100)),
      shapeXml("c", 4, frame(240, 0, 100, 100)),
      shapeXml("d", 5, frame(360, 0, 100, 100)),
    );
    const result = patchGroupsInSlideXml(xml, {
      elements: [
        element("a", frame(0, 0, 100, 100)),
        element("b", frame(120, 0, 100, 100)),
        element("c", frame(240, 0, 100, 100)),
        element("d", frame(360, 0, 100, 100)),
      ],
      groups: [group("first", ["a", "b"]), group("second", ["c", "d"])],
    });

    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
    expect((result.xml.match(/<p:grpSp>/g) ?? []).length).toBe(2);
    expect((result.xml.match(/<\/p:grpSp>/g) ?? []).length).toBe(2);
  });

  it("includes the area covered by a rotated member", () => {
    const xml = slideXml(
      shapeXml("a", 2, frame(100, 100, 100, 50)),
      shapeXml("b", 3, frame(100, 100, 100, 50)),
    );
    const result = patchGroupsInSlideXml(xml, {
      elements: [
        element("a", frame(100, 100, 100, 50)),
        element("b", frame(100, 100, 100, 50), 90_000),
      ],
      groups: [group("rotated", ["a", "b"])],
    });

    expect(result.written).toBe(1);
    expect(result.xml).toContain('<a:off x="100" y="75"/><a:ext cx="100" cy="100"/>');
  });

  it("leaves a page without groups byte-for-byte unchanged", () => {
    const xml = slideXml(shapeXml("a", 2, frame(0, 0, 100, 100)));
    const result = patchGroupsInSlideXml(xml, {
      elements: [element("a", frame(0, 0, 100, 100))],
      groups: [],
    });

    expect(result).toEqual({ xml, written: 0, skipped: 0 });
  });
});

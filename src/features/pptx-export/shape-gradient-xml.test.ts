import { describe, expect, it } from "vitest";
import { patchShapeGradientsInXml, shapeGradientXml } from "./shape-gradient-xml";

const gradient = {
  angleDeg: 45,
  stops: [
    { offset: 0, color: "#B34439" },
    { offset: 0.52, color: "#A62B1F", transparency: 20 },
    { offset: 1, color: "#74201A" },
  ],
};

const xml = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="shape-1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="A62B1F"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="shape-2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`;

describe("shape gradient XML", () => {
  it("writes ordered stops, angle and alpha", () => {
    const markup = shapeGradientXml(gradient);
    expect(markup).toContain("<a:gradFill");
    expect(markup).toContain('<a:lin ang="2700000" scaled="0"/>');
    expect(markup).toContain('<a:gs pos="0"><a:srgbClr val="B34439">');
    expect(markup).toContain('<a:alpha val="80000"/>');
    expect(markup).toContain('<a:gs pos="100000"><a:srgbClr val="74201A">');
  });

  it("replaces only the named shape fill and keeps its line", () => {
    const result = patchShapeGradientsInXml(xml, new Map([["shape-1", shapeGradientXml(gradient)]]));
    expect(result.patched).toBe(1);
    expect(result.xml).toContain("<a:gradFill");
    expect(result.xml).toContain('<a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>');
    expect(result.xml).toContain('name="shape-2"');
    expect(result.xml).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
  });

  it("leaves the part untouched when the shape is not found", () => {
    const result = patchShapeGradientsInXml(xml, new Map([["missing", shapeGradientXml(gradient)]]));
    expect(result.patched).toBe(0);
    expect(result.xml).toBe(xml);
  });
});

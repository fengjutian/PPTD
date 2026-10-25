import { writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it } from "vitest";
import { gradientImage } from "./fixture";

/**
 * WP2 probe: does each element effect survive as native OOXML?
 *
 * Four slides, one question each — shadow, image tone, picture shape crop,
 * corner radius. The deck is written to `.tmp/probe-effects.pptx` and opened by
 * PowerPoint and LibreOffice. This file is scratch work for ADR 0102, not a
 * production path: the exporter will reuse the same XML shapes.
 */

const IMAGE = gradientImage();

/** Rewrites the nth picture's `<a:blip>` with an effect child. */
function patchBlip(xml: string, index: number, effect: string): string {
  let seen = 0;
  // PptxGenJS writes `<a:blip r:embed="rId1"></a:blip>`, an expanded pair rather
  // than a self-closing tag, so the pattern has to accept both forms.
  return xml.replace(/<a:blip([^>]*?)(\/?)>(\s*<\/a:blip>)?/g, (match, attributes: string, selfClose: string) => {
    seen += 1;
    if (seen !== index) return match;
    const clean = selfClose ? attributes.replace(/\/$/, "") : attributes;
    return `<a:blip${clean}>${effect}</a:blip>`;
  });
}

/**
 * Rewrites the nth picture from `p:pic` to a `p:sp` filled with the same image
 * and clipped by `prstGeom`.
 *
 * This is the risky one: the object stops being a picture and becomes a shape
 * with a picture fill. Call it from the last picture backwards, because each
 * rewrite removes one `p:pic` from the document.
 */
function shapeCropPicture(xml: string, index: number, prst: string, srcRect?: string): string {
  const pictures = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
  const target = pictures[index - 1];
  if (!target) throw new Error(`picture ${index} not found`);
  const block = target[0];
  const embed = /r:embed="([^"]+)"/.exec(block)?.[1];
  const offset = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(block);
  const extent = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(block);
  const id = /<p:cNvPr id="(\d+)"/.exec(block)?.[1];
  const name = /name="([^"]*)"/.exec(block)?.[1] ?? "Picture";
  if (!embed || !offset || !extent || !id) throw new Error("picture shape is not the expected form");
  const replacement =
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${offset[1]}" y="${offset[2]}"/>` +
    `<a:ext cx="${extent[1]}" cy="${extent[2]}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `<a:blipFill><a:blip r:embed="${embed}"/>${srcRect ?? ""}<a:stretch><a:fillRect/></a:stretch></a:blipFill>` +
    `</p:spPr></p:sp>`;
  return xml.replace(block, replacement);
}

describe("effects probe", () => {
  it("writes a deck with shadow, duotone, shape crop and corners", async () => {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "PPT_16x9", width: 13.333, height: 7.5 });
    pptx.layout = "PPT_16x9";

    const shadows = [
      { label: "card", blur: 6, distance: 2, opacity: 0.18 },
      { label: "raised", blur: 14, distance: 4, opacity: 0.26 },
      { label: "emphasis", blur: 26, distance: 8, opacity: 0.34 },
    ];
    const slide1 = pptx.addSlide();
    slide1.addText("阴影档位", { x: 0.8, y: 0.5, w: 6, h: 0.7, fontSize: 32, bold: true, color: "1E3550" });
    shadows.forEach((shadow, index) => {
      slide1.addShape(pptx.ShapeType.roundRect, {
        x: 0.9 + index * 4.1,
        y: 1.8,
        w: 3.4,
        h: 3.2,
        fill: { color: "FFFFFF" },
        line: { color: "E2E7EC", width: 1 },
        rectRadius: 0.06,
        shadow: {
          type: "outer",
          color: "12233D",
          blur: shadow.blur,
          angle: 45,
          distance: shadow.distance,
          opacity: shadow.opacity,
        },
      });
      slide1.addText(shadow.label, {
        x: 0.9 + index * 4.1,
        y: 5.2,
        w: 3.4,
        h: 0.5,
        fontSize: 16,
        color: "5F6B76",
        align: "center",
      });
    });

    const slide2 = pptx.addSlide();
    slide2.addText("图片色调", { x: 0.8, y: 0.5, w: 6, h: 0.7, fontSize: 32, bold: true, color: "1E3550" });
    [0, 1, 2].forEach((index) => {
      slide2.addImage({ data: IMAGE, x: 0.9 + index * 4.1, y: 1.7, w: 3.4, h: 2.6 });
    });
    ["原图", "duotone", "lum +30%"].forEach((label, index) => {
      slide2.addText(label, {
        x: 0.9 + index * 4.1,
        y: 4.5,
        w: 3.4,
        h: 0.4,
        fontSize: 14,
        color: "5F6B76",
      });
    });

    const slide3 = pptx.addSlide();
    slide3.addText("图片形状裁剪", { x: 0.8, y: 0.5, w: 8, h: 0.7, fontSize: 32, bold: true, color: "1E3550" });
    [0, 1].forEach((index) => {
      slide3.addImage({ data: IMAGE, x: 1.6 + index * 5.4, y: 1.8, w: 3.6, h: 3.6 });
    });
    slide3.addText("ellipse", { x: 1.6, y: 5.6, w: 3.6, h: 0.4, fontSize: 14, color: "5F6B76" });
    slide3.addText("roundRect", { x: 7.0, y: 5.6, w: 3.6, h: 0.4, fontSize: 14, color: "5F6B76" });

    const slide4 = pptx.addSlide();
    slide4.addText("圆角档位", { x: 0.8, y: 0.5, w: 6, h: 0.7, fontSize: 32, bold: true, color: "1E3550" });
    [0.04, 0.12, 0.28].forEach((radius, index) => {
      slide4.addShape(pptx.ShapeType.roundRect, {
        x: 0.9 + index * 4.1,
        y: 1.8,
        w: 3.4,
        h: 3.2,
        fill: { color: "EAF5F2" },
        line: { color: "0F7869", width: 1 },
        rectRadius: radius,
      });
      slide4.addText(`radius ${radius}`, {
        x: 0.9 + index * 4.1,
        y: 5.2,
        w: 3.4,
        h: 0.5,
        fontSize: 16,
        color: "5F6B76",
        align: "center",
      });
    });

    const raw = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
    const entries = unzipSync(raw);

    const tone = strFromU8(entries["ppt/slides/slide2.xml"]!);
    const duotone = '<a:duotone><a:srgbClr val="0F7869"/><a:srgbClr val="0B1F3A"/></a:duotone>';
    const bright = '<a:lum bright="30000" contrast="0"/>';
    entries["ppt/slides/slide2.xml"] = strToU8(patchBlip(patchBlip(tone, 3, bright), 2, duotone));

    const crop = strFromU8(entries["ppt/slides/slide3.xml"]!);
    // The ellipse carries an `a:srcRect` (cover crop: a 320×180 source into a
    // 1:1 frame loses 21.9% on each side) so the picture is cropped rather than
    // stretched. The roundRect is left without it on purpose: the difference is
    // the point of the probe.
    entries["ppt/slides/slide3.xml"] = strToU8(
      shapeCropPicture(
        shapeCropPicture(crop, 2, "roundRect"),
        1,
        "ellipse",
        '<a:srcRect l="21875" t="0" r="21875" b="0"/>',
      ),
    );

    const out = zipSync(entries);
    writeFileSync(".tmp/probe-effects.pptx", out);
    expect(out.byteLength).toBeGreaterThan(10_000);
    // Assert on the artifact, not on the in-memory map: the point of the probe
    // is what ends up inside the package PowerPoint opens.
    const verify = unzipSync(out);
    expect(strFromU8(verify["ppt/slides/slide2.xml"]!)).toContain("<a:duotone>");
    expect(strFromU8(verify["ppt/slides/slide3.xml"]!)).toContain('prst="ellipse"');
    expect(strFromU8(verify["ppt/slides/slide3.xml"]!)).toContain('prst="roundRect"');
  });
});

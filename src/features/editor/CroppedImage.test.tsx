import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emu, type ImageElement } from "../../core/document-model";
import { CroppedImage } from "./CroppedImage";

function imageElement(source: string): ImageElement {
  return {
    id: crypto.randomUUID() as ImageElement["id"],
    type: "image",
    frame: { x: emu(0), y: emu(0), width: emu(914_400), height: emu(914_400) },
    rotationMilliDegree: 0,
    locked: false,
    source: { kind: "embedded", dataUrl: source, mimeType: "image/png" },
    altText: "模板版式背景",
  };
}

describe("图片元素", () => {
  it("读不到资源时不画图片，只留一个占位块", () => {
    const markup = renderToStaticMarkup(
      <CroppedImage element={imageElement("asset://unknown.png")} className="image-fill" />,
    );

    // 浏览器会给加载失败的图片画一个破图图标，页面不能出现它。
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("asset://");
    expect(markup).toContain("image-fill");
  });

  it("读不到资源的占位块标成缺图，不会被当成空白页", () => {
    const markup = renderToStaticMarkup(
      <CroppedImage element={imageElement("asset://unknown.png")} className="image-fill" />,
    );

    // 一块纯白看起来就像作者本来就没放图，模板版式背景就是这样消失的。
    expect(markup).toContain("image-missing");
  });

  it("内联的图片直接画出来", () => {
    const markup = renderToStaticMarkup(
      <CroppedImage element={imageElement("data:image/png;base64,AA==")} className="image-fill" />,
    );

    expect(markup).toContain('src="data:image/png;base64,AA=="');
    expect(markup).toContain("模板版式背景");
  });

  it("带双色映射的图片用同一个映射画，而不是叠一层色块", () => {
    const element = { ...imageElement("data:image/png;base64,AA=="), tone: { dark: "#000000", light: "#FFFFFF" } };
    const markup = renderToStaticMarkup(<CroppedImage element={element} className="image-fill" />);

    // 滤镜的两端就是文档里的两端，画布与导出必须看到同一张图。
    expect(markup).toContain("<feColorMatrix");
    expect(markup).toContain('tableValues="0.0000 1.0000"');
    expect(markup).toContain("filter:url(#tone-");
    // 没有 toned 的图片不该凭空多出一个滤镜。
    const plain = renderToStaticMarkup(
      <CroppedImage element={imageElement("data:image/png;base64,AA==")} className="image-fill" />,
    );
    expect(plain).not.toContain("<filter");
  });
});

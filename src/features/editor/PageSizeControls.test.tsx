import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, inches, type SlideElement } from "../../core/document-model";
import { PageSizeControls } from "./PageSizeControls";

describe("page size controls", () => {
  it("offers the presets and marks the current one", () => {
    const document = createDocument();
    const markup = renderToStaticMarkup(
      <PageSizeControls pageSize={document.pageSize} elements={[]} execute={() => undefined} />,
    );
    expect(markup).toContain("16:9");
    expect(markup).toContain("4:3");
    expect(markup).toContain("16:10");
    expect(markup).toContain("应用");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("13.33");
    expect(markup).toContain("7.5");
  });

  it("counts objects that no longer fit the page", () => {
    const document = createDocument();
    const outside: SlideElement = {
      ...document.slides[0]!.elements[0]!,
      frame: {
        x: emu(document.pageSize.width - inches(1)),
        y: emu(document.pageSize.height - inches(1)),
        width: inches(3),
        height: inches(2),
      },
    };
    const markup = renderToStaticMarkup(
      <PageSizeControls pageSize={document.pageSize} elements={[outside]} execute={() => undefined} />,
    );
    expect(markup).toContain("1 个对象在页面外");
  });
});

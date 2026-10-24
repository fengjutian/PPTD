import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import type { ImageElement, SlideId } from "../document-model";
import { buildDesignPreviewDocument } from "../../../tools/design-preview/fixture";

function imageOf(document: ReturnType<typeof buildDesignPreviewDocument>): {
  slideId: SlideId;
  image: ImageElement;
} {
  for (const slide of document.slides) {
    const image = slide.elements.find((element): element is ImageElement => element.type === "image");
    if (image) return { slideId: slide.id, image };
  }
  throw new Error("fixture has no image");
}

describe("image provenance", () => {
  it("requires a source and a licence to be marked verified", () => {
    const document = buildDesignPreviewDocument();
    const { slideId, image } = imageOf(document);
    expect(() =>
      applyCommand(document, {
        type: "set-image-provenance",
        slideId: slideId,
        elementId: image.id,
        provenance: { verification: "verified", sourceUrl: "https://example.com/photo" },
      }),
    ).toThrow("IMAGE_PROVENANCE_INCOMPLETE");
  });

  it("stores the source, licence and a hash of the embedded bytes", () => {
    const document = buildDesignPreviewDocument();
    const { slideId, image } = imageOf(document);
    applyCommand(document, {
      type: "set-image-provenance",
      slideId: slideId,
      elementId: image.id,
      provenance: {
        verification: "verified",
        sourceUrl: "  https://example.com/photo  ",
        license: "  CC BY 4.0  ",
      },
    });
    expect(image.provenance).toMatchObject({
      verification: "verified",
      sourceUrl: "https://example.com/photo",
      license: "CC BY 4.0",
    });
    expect(image.provenance?.contentHash).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof image.provenance?.checkedAt).toBe("string");
  });

  it("keeps unverified pictures pending and rejects a bad URL", () => {
    const document = buildDesignPreviewDocument();
    const { slideId, image } = imageOf(document);
    applyCommand(document, {
      type: "set-image-provenance",
      slideId: slideId,
      elementId: image.id,
      provenance: { verification: "pending" },
    });
    expect(image.provenance?.verification).toBe("pending");
    expect(image.provenance?.contentHash).toMatch(/^[0-9a-f]{16}$/);

    expect(() =>
      applyCommand(document, {
        type: "set-image-provenance",
        slideId: slideId,
        elementId: image.id,
        provenance: { verification: "pending", sourceUrl: "file:///secret.png" },
      }),
    ).toThrow("IMAGE_PROVENANCE_URL_INVALID");
  });

  it("clears provenance without touching the picture", () => {
    const document = buildDesignPreviewDocument();
    const { slideId, image } = imageOf(document);
    applyCommand(document, {
      type: "set-image-provenance",
      slideId: slideId,
      elementId: image.id,
      provenance: { verification: "user" },
    });
    applyCommand(document, {
      type: "set-image-provenance",
      slideId: slideId,
      elementId: image.id,
      provenance: null,
    });
    expect(image.provenance).toBeUndefined();
    expect(image.type).toBe("image");
  });
});

import type { DocumentCommand } from "../../core/commands";
import type { SlideId, SupportedImageMimeType } from "../../core/document-model";

export const BACKGROUND_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Reads a picture chosen for the page background.
 *
 * The file types the editor accepts are the ones the exporter can embed, so an
 * unsupported file is rejected before it reaches the document instead of
 * becoming a background the PPTX cannot carry.
 */
export function readSlideBackground(
  file: File | undefined,
  slideId: SlideId,
  onCommand: (command: DocumentCommand) => void,
  onError?: (message: string) => void,
): void {
  if (!file) return;
  if (!(BACKGROUND_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    onError?.("背景图必须是 PNG、JPEG 或 WebP");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => onError?.("背景图读取失败");
  reader.addEventListener("load", () => {
    if (typeof reader.result !== "string") {
      onError?.("背景图读取失败");
      return;
    }
    onCommand({
      type: "set-slide-background-image",
      slideId,
      dataUrl: reader.result,
      mimeType: file.type as SupportedImageMimeType,
    });
  });
  reader.readAsDataURL(file);
}

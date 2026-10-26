import { useRef } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import type { DocumentCommand } from "../../core/commands";
import type { SlideId } from "../../core/document-model";

import { normalizeHexColor } from "./inspector-color";
import { BACKGROUND_IMAGE_TYPES, readSlideBackground } from "./slide-background";

/**
 * Page background controls of the “设计” ribbon.
 *
 * The background belongs to the page, so both controls write commands instead
 * of touching the slide. A colour keeps the reviewed copy and every object
 * untouched; a picture is inserted as a locked slide-background layer and can
 * be removed without deleting user pictures.
 */
export function SlideBackgroundTools({
  slideId,
  background,
  hasBackgroundImage,
  onCommand,
  onStatus,
}: {
  slideId: SlideId;
  background: string;
  hasBackgroundImage: boolean;
  onCommand: (command: DocumentCommand) => void;
  onStatus?: (message: string) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);

  return (
    <div className="ribbon-background-tools" role="group" aria-label="页面背景">
      <label className="ribbon-color-control" title="页面背景色">
        <span>背景</span>
        <input
          type="color"
          aria-label="页面背景色"
          value={normalizeHexColor(background) ?? "#FFFFFF"}
          onChange={(event) =>
            onCommand({ type: "set-slide-background", slideId, background: event.target.value.toUpperCase() })
          }
        />
      </label>
      <div className="ribbon-background-actions">
        <button type="button" title="选择页面背景图片" onClick={() => imageInput.current?.click()}>
          <ImagePlus />
          <span>{hasBackgroundImage ? "换图" : "背景图"}</span>
        </button>
        {hasBackgroundImage && (
          <button
            type="button"
            aria-label="移除页面背景图片"
            title="移除页面背景图片"
            onClick={() => onCommand({ type: "remove-slide-background-image", slideId })}
          >
            <Trash2 />
          </button>
        )}
      </div>
      <input
        ref={imageInput}
        className="visually-hidden"
        type="file"
        accept={BACKGROUND_IMAGE_TYPES.join(",")}
        onChange={(event) => {
          readSlideBackground(event.currentTarget.files?.[0], slideId, onCommand, onStatus);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

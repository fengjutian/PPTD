import { useRef } from "react";

import { ImagePlus, Trash2 } from "lucide-react";
import { type Emu, type SlideId, type SlideTransition } from "../../core/document-model";
import type { DocumentCommand } from "../../core/commands";

import { ColorField, TextAreaField } from "./inspector-fields";
import { emuToUnit, unitLabel, type LengthUnit } from "./inspector-geometry";

import { TransitionControls } from "./TransitionControls";

import { InspectorSection } from "./InspectorPanels";
import { BACKGROUND_IMAGE_TYPES, readSlideBackground } from "./slide-background";

interface PagePropertiesProps {
  slideId: SlideId;
  background: string;
  pageSize: { width: Emu; height: Emu };
  /** The speaker notes of this page. */
  speakerNotes: string;
  /** Native transition into this page. Absent means no transition. */
  transition?: SlideTransition;
  unit: LengthUnit;
  palette?: readonly string[];
  onCommand: (command: DocumentCommand) => void;
  backgroundImage: boolean;
}

export function PageProperties({
  slideId,
  background,
  pageSize,
  speakerNotes,
  transition,
  backgroundImage,
  unit,
  palette,
  onCommand,
}: PagePropertiesProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <InspectorSection title="页面">
        <div className="field">
          <span className="field-label">幻灯片尺寸</span>
          {/* The page size belongs to the document, not to one element. It is
            edited from the “设计” ribbon and only read here. */}
          <span className="field-readonly">{`${emuToUnit(pageSize.width, unit).toFixed(2)} × ${emuToUnit(pageSize.height, unit).toFixed(2)} ${unitLabel(unit)}`}</span>
        </div>
        <ColorField
          label="背景色"
          value={background}
          wide
          swatches={palette}
          onCommit={(next) => onCommand({ type: "set-slide-background", slideId, background: next })}
        />
        <div className="field">
          <span className="field-label">背景图片</span>
          <input
            ref={imageInput}
            type="file"
            accept={BACKGROUND_IMAGE_TYPES.join(",")}
            hidden
            onChange={(event) => {
              readSlideBackground(event.currentTarget.files?.[0], slideId, onCommand);
              event.currentTarget.value = "";
            }}
          />
          <div className="field-row">
            <button type="button" className="toggle-button" onClick={() => imageInput.current?.click()}>
              <ImagePlus />
              {backgroundImage ? "替换背景图" : "选择背景图"}
            </button>
            {backgroundImage && (
              <button
                type="button"
                className="toggle-button"
                onClick={() => onCommand({ type: "remove-slide-background-image", slideId })}
              >
                <Trash2 />
                移除
              </button>
            )}
          </div>
        </div>
      </InspectorSection>
      <InspectorSection title="切换">
        <TransitionControls slideId={slideId} transition={transition} onCommand={onCommand} />
      </InspectorSection>
      <InspectorSection title="演讲备注">
        <TextAreaField
          label="备注"
          value={speakerNotes}
          placeholder="这一页要讲的内容，会写进 PPTX 的备注页"
          rows={5}
          maxLength={20_000}
          onCommit={(notes) => onCommand({ type: "set-speaker-notes", slideId, notes })}
        />
        <p className="field-help">备注不会显示在页面上，但会跟着这一页一起导出。</p>
      </InspectorSection>
    </>
  );
}

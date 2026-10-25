import { RotateCcw } from "lucide-react";
import {
  type AssetProvenance,
  type ChartKind,
  type ContentBlock,
  type ImageCrop,
  type SlideElement,
  type SlideId,
} from "../../core/document-model";
import type { DocumentCommand } from "../../core/commands";

import { InspectorSection } from "./InspectorPanels";
import { ColorField, NumberField, SelectField, TextField } from "./inspector-fields";

import { MetricFields, TableDataFields, type MetricFieldValue } from "./StructuredContentFields";

import { FONT_OPTIONS } from "./font-options";

export function ChartInspector({
  element,
  slideId,
  locked,
  palette,
  chartMetrics,
  onCommand,
}: {
  element: Extract<SlideElement, { type: "chart" }>;
  slideId: SlideId;
  locked: boolean;
  palette?: readonly string[];
  chartMetrics: MetricFieldValue[];
  onCommand: (command: DocumentCommand) => void;
}) {
  return (
    <InspectorSection title="图表">
      {chartMetrics.length > 0 ? (
        <>
          <MetricFields slideId={slideId} metrics={chartMetrics} disabled={locked} onCommand={onCommand} />
          {chartMetrics.length < element.contentBlockIds.length && (
            <p className="inspector-hint">有指标内容已不存在，图表只显示还能读到的数据。</p>
          )}
        </>
      ) : (
        <p className="inspector-hint">图表引用的指标内容已经不存在，暂时没有可编辑的数据。</p>
      )}
      <div className="property-grid">
        <SelectField
          label="类型"
          value={element.kind}
          disabled={locked}
          options={["column", "bar", "line", "pie"]}
          optionLabels={{ column: "柱状图", bar: "条形图", line: "折线图", pie: "饼图" }}
          onCommit={(kind) =>
            onCommand({ type: "set-chart-kind", slideId, elementId: element.id, kind: kind as ChartKind })
          }
        />
        <ColorField
          label="系列颜色"
          value={element.style.seriesColors[0] ?? "#3366CC"}
          swatches={palette}
          disabled={locked}
          onCommit={(color) =>
            onCommand({
              type: "set-chart-style",
              slideId,
              elementId: element.id,
              style: { seriesColors: [color, ...element.style.seriesColors.slice(1)] },
            })
          }
        />
        <NumberField
          label="字号"
          unit="pt"
          value={element.style.fontSizePt}
          min={4}
          max={400}
          precision={0}
          disabled={locked}
          onCommit={(fontSizePt) =>
            onCommand({ type: "set-chart-style", slideId, elementId: element.id, style: { fontSizePt } })
          }
        />
      </div>
      <div className="field-row">
        <label>
          <input
            type="checkbox"
            checked={element.style.showValueLabels}
            disabled={locked}
            onChange={(event) =>
              onCommand({
                type: "set-chart-style",
                slideId,
                elementId: element.id,
                style: { showValueLabels: event.target.checked },
              })
            }
          />
          显示数值
        </label>
        <label>
          <input
            type="checkbox"
            checked={element.style.showLegend}
            disabled={locked}
            onChange={(event) =>
              onCommand({
                type: "set-chart-style",
                slideId,
                elementId: element.id,
                style: { showLegend: event.target.checked },
              })
            }
          />
          显示图例
        </label>
      </div>
      <p className="inspector-hint">图表的数值来自本页已审核的指标，导出后在 PowerPoint 中仍是可编辑的图表对象。</p>
    </InspectorSection>
  );
}

export function TableInspector({
  element,
  slideId,
  locked,
  tableBlock,
  palette,
  onCommand,
}: {
  element: Extract<SlideElement, { type: "table" }>;
  slideId: SlideId;
  locked: boolean;
  tableBlock: Extract<ContentBlock, { type: "table-data" }> | undefined;
  palette?: readonly string[];
  onCommand: (command: DocumentCommand) => void;
}) {
  return (
    <InspectorSection title="表格">
      {tableBlock ? (
        <TableDataFields
          slideId={slideId}
          blockId={tableBlock.id}
          header={tableBlock.header}
          rows={tableBlock.rows}
          disabled={locked}
          onCommand={onCommand}
        />
      ) : (
        <p className="inspector-hint">这页的表格数据已经不存在，表格暂时没有单元格。</p>
      )}
      <div className="property-grid">
        <SelectField
          label="字体"
          value={element.style.fontFamily}
          disabled={locked}
          options={FONT_OPTIONS}
          onCommit={(fontFamily) =>
            onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { fontFamily } })
          }
        />
        <NumberField
          label="字号"
          unit="pt"
          value={element.style.fontSizePt}
          min={4}
          max={400}
          precision={0}
          disabled={locked}
          onCommit={(fontSizePt) =>
            onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { fontSizePt } })
          }
        />
        <ColorField
          label="表头填充"
          value={element.style.headerFill}
          wide
          swatches={palette}
          disabled={locked}
          onCommit={(headerFill) =>
            onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { headerFill } })
          }
        />
        <ColorField
          label="表头文字"
          value={element.style.headerTextColor}
          wide
          swatches={palette}
          disabled={locked}
          onCommit={(headerTextColor) =>
            onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { headerTextColor } })
          }
        />
        <ColorField
          label="正文文字"
          value={element.style.bodyTextColor}
          wide
          swatches={palette}
          disabled={locked}
          onCommit={(bodyTextColor) =>
            onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { bodyTextColor } })
          }
        />
        <ColorField
          label="边框"
          value={element.style.borderColor}
          wide
          swatches={palette}
          disabled={locked}
          onCommit={(borderColor) =>
            onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { borderColor } })
          }
        />
      </div>
      <div className="field-row">
        <label>
          <input
            type="checkbox"
            checked={element.style.firstColumnBold}
            disabled={locked}
            onChange={(event) =>
              onCommand({
                type: "set-table-style",
                slideId,
                elementId: element.id,
                style: { firstColumnBold: event.target.checked },
              })
            }
          />
          首列加粗
        </label>
      </div>
      <p className="inspector-hint">
        表格的单元格来自本页已审核的表格数据，导出后在 PowerPoint 中仍是可编辑的表格对象。
      </p>
    </InspectorSection>
  );
}

export function ImageInspector({
  element,
  slideId,
  locked,
  crop,
  commitCrop,
  updateProvenance,
  onCommand,
}: {
  element: Extract<SlideElement, { type: "image" }>;
  slideId: SlideId;
  locked: boolean;
  crop: ImageCrop | undefined;
  commitCrop: (side: "top" | "right" | "bottom" | "left", percent: number) => void;
  updateProvenance: (patch: Partial<AssetProvenance>) => void;
  onCommand: (command: DocumentCommand) => void;
}) {
  return (
    <InspectorSection title="图片">
      <TextField
        label="替代文本"
        value={element.altText}
        maxLength={500}
        disabled={locked}
        onCommit={(altText) => onCommand({ type: "set-image-alt-text", slideId, elementId: element.id, altText })}
      />
      <div className="field-label">素材来源</div>
      <TextField
        label="来源 URL"
        value={element.provenance?.sourceUrl ?? ""}
        maxLength={2048}
        disabled={locked}
        placeholder="https://…"
        onCommit={(value) => updateProvenance({ sourceUrl: value })}
      />
      <TextField
        label="许可说明"
        value={element.provenance?.license ?? ""}
        maxLength={200}
        disabled={locked}
        placeholder="例如 CC BY 4.0 / 已购买授权"
        onCommit={(value) => updateProvenance({ license: value })}
      />
      <div className="field-row">
        <span
          className={`taste-badge${
            element.provenance?.verification === "verified" ? " hard" : element.provenance ? " muted" : ""
          }`}
        >
          {element.provenance?.verification === "verified"
            ? "已核验"
            : element.provenance?.verification === "user"
              ? "用户素材"
              : element.provenance
                ? "待核验"
                : "未标注"}
        </span>
        <button
          type="button"
          className="toggle-button"
          disabled={locked || !element.provenance?.sourceUrl?.trim() || !element.provenance?.license?.trim()}
          onClick={() => updateProvenance({ verification: "verified" })}
        >
          标记已核验
        </button>
        {element.provenance && (
          <button
            type="button"
            className="toggle-button"
            disabled={locked}
            onClick={() =>
              onCommand({ type: "set-image-provenance", slideId, elementId: element.id, provenance: null })
            }
          >
            清除来源
          </button>
        )}
      </div>
      <div className="field-label crop-label">裁剪（源图切去的比例）</div>
      <div className="property-grid">
        <NumberField
          label="上"
          unit="%"
          value={(crop?.top ?? 0) * 100}
          min={0}
          max={99}
          precision={0}
          disabled={locked}
          onCommit={(percent) => commitCrop("top", percent)}
        />
        <NumberField
          label="下"
          unit="%"
          value={(crop?.bottom ?? 0) * 100}
          min={0}
          max={99}
          precision={0}
          disabled={locked}
          onCommit={(percent) => commitCrop("bottom", percent)}
        />
        <NumberField
          label="左"
          unit="%"
          value={(crop?.left ?? 0) * 100}
          min={0}
          max={99}
          precision={0}
          disabled={locked}
          onCommit={(percent) => commitCrop("left", percent)}
        />
        <NumberField
          label="右"
          unit="%"
          value={(crop?.right ?? 0) * 100}
          min={0}
          max={99}
          precision={0}
          disabled={locked}
          onCommit={(percent) => commitCrop("right", percent)}
        />
      </div>
      <div className="field-row">
        <button
          type="button"
          className="toggle-button"
          disabled={locked || !crop}
          onClick={() => onCommand({ type: "set-image-crop", slideId, elementId: element.id, crop: null })}
        >
          <RotateCcw />
          重置裁剪
        </button>
      </div>
    </InspectorSection>
  );
}

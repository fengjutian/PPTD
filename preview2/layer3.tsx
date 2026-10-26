import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/styles.css";
import { LayerList } from "../src/features/editor/LayerList";
import {
  createDocument,
  inches,
  type ElementId,
  type SlideElement,
  type TextElement,
} from "../src/core/document-model";

const deck = createDocument();
const slide = deck.slides[0]!;

const frame = (x: number, y: number, width: number, height: number) => ({
  x: inches(x),
  y: inches(y),
  width: inches(width),
  height: inches(height),
});

function text(
  id: string,
  value: string,
  frameValue: ReturnType<typeof frame>,
  options: { locked?: boolean; bold?: boolean; color?: string; size?: number; name?: string; hidden?: boolean } = {},
): TextElement {
  return {
    id: id as ElementId,
    type: "text",
    frame: frameValue,
    rotationMilliDegree: 0,
    locked: options.locked ?? false,
    ...(options.name ? { name: options.name } : {}),
    ...(options.hidden ? { hidden: true } : {}),
    text: value,
    style: {
      fontFamily: "Microsoft YaHei",
      fontSizePt: options.size ?? 20,
      color: options.color ?? "#17181c",
      bold: options.bold ?? false,
      align: "left",
    },
  };
}

const elements: SlideElement[] = [
  text("t2", "广告基本盘稳固，云与 AI 双轮驱动", frame(0.9, 2.2, 6.2, 1.2), { locked: true, size: 30 }),
  text("t3", "Alphabet 2023 年报点评", frame(0.9, 3.6, 5.6, 0.6), { size: 18, color: "#3b5bdb" }),
  {
    id: "s1" as ElementId,
    type: "shape",
    shape: "rectangle",
    frame: frame(0.9, 4.5, 2.4, 1.1),
    rotationMilliDegree: 0,
    locked: false,
    style: { fill: "#2563eb", stroke: "#1e40af", strokeWidthPt: 1, radiusPt: 8 },
  },
  {
    id: "s2" as ElementId,
    type: "shape",
    shape: "ellipse",
    frame: frame(3.7, 4.5, 1.4, 1.1),
    rotationMilliDegree: 0,
    locked: false,
    style: { fill: "#f59e0b", stroke: "#b45309", strokeWidthPt: 1, radiusPt: 0 },
  },
  {
    id: "i1" as ElementId,
    type: "image",
    frame: frame(7.2, 0, 6.1, 7.5),
    rotationMilliDegree: 0,
    locked: false,
    hidden: true,
    name: "右侧光轨",
    source: {
      kind: "embedded",
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII=",
      mimeType: "image/png",
    },
    altText: "财经杂志编辑摄影或高对比度抽象光轨",
  },
  text(
    "t1",
    "Alphabet 2023 年报：广告基本盘与 AI 第二曲线同时加速，AI 重塑增长路径",
    frame(0.9, 0.8, 6.2, 1.4),
    { bold: true, size: 40, color: "#111827", name: "主标题" },
  ),
];

slide.elements = elements;
slide.groups = [{ id: "group-1", elementIds: ["t1" as ElementId, "s1" as ElementId] }];
slide.animations = [
  {
    id: "animation-1",
    elementId: "t1" as ElementId,
    effect: "fly-in",
    phase: "entrance",
    start: "on-click",
    durationMs: 500,
    delayMs: 0,
    direction: "left",
  },
];

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
if (theme) document.documentElement.dataset.theme = theme;

function Preview() {
  const [selected, setSelected] = useState<ElementId[]>(["t1" as ElementId, "s1" as ElementId]);
  return (
    <div style={{ minHeight: "100vh", padding: 24, background: "#0b0c0e" }}>
      <aside className="left-panel" style={{ width: 280, height: 760, display: "flex" }}>
        <div className="panel-heading">
          <div className="panel-tabs" role="tablist">
            <button type="button" className="panel-tab" role="tab">
              页面
            </button>
            <button type="button" className="panel-tab active" role="tab" aria-selected="true">
              图层
            </button>
          </div>
        </div>
        <LayerList
          slide={slide}
          selectedElementIds={selected}
          onSelect={(id) => setSelected([id])}
          onToggle={(id) =>
            setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
          }
          onSelectMany={(ids) => setSelected(ids)}
          onCommand={(command) => {
            const log = ((window as unknown as { __commands?: unknown[] }).__commands ??= []);
            log.push(command);
          }}
        />
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);

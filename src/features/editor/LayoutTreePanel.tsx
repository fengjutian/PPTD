import { useMemo, useState, type DragEvent } from "react";
import { Bot, ChevronDown, ChevronRight, LayoutTemplate, Unlink } from "lucide-react";

import type { DocumentCommand } from "../../core/commands";
import type { PresentationDocument, Slide } from "../../core/document-model";
import {
  compileLayoutFramePlan,
  createStarterLayoutDefinition,
  detachedOverride,
  fraction,
  moveLayoutNode,
  updateLayoutNode,
  type LayoutBinding,
  type LayoutDefinition,
  type LayoutNode,
} from "../../core/layout/tree";

function flatten(node: LayoutNode, depth = 0): Array<{ node: LayoutNode; depth: number }> {
  return [{ node, depth }, ...(node.type === "slot" ? [] : node.children.flatMap((child) => flatten(child, depth + 1)))];
}

function autoBinding(definition: LayoutDefinition, slide: Slide): LayoutBinding {
  const slots = flatten(definition.tree.root).map((item) => item.node).filter((node) => node.type === "slot");
  const slotBindings: Record<string, string> = {};
  for (const slot of slots) {
    if (slot.type !== "slot") continue;
    const target = slide.elements.find((element) =>
      slot.role === "title"
        ? element.type === "text" && element.contentRef === "title"
        : slot.role === "body"
          ? element.type === "text" && element.contentRef === "body"
          : element.type === slot.role,
    );
    if (target) slotBindings[slot.id] = target.id;
  }
  return { definitionId: definition.id, slotBindings };
}

function updatedDefinitions(document: PresentationDocument, definition: LayoutDefinition): LayoutDefinition[] {
  return [...(document.layoutDefinitions ?? []).filter((item) => item.id !== definition.id), definition];
}

export function LayoutTreePanel({
  document,
  slide,
  onCommand,
}: {
  document: PresentationDocument;
  slide: Slide;
  onCommand: (command: DocumentCommand) => void;
}) {
  const [open, setOpen] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [draggedNodeId, setDraggedNodeId] = useState<string>();
  const [proposal, setProposal] = useState<{ definition: LayoutDefinition; summary: string[] }>();
  const definition = document.layoutDefinitions?.find((item) => item.id === slide.layoutBinding?.definitionId);
  const rows = useMemo(() => (definition ? flatten(definition.tree.root) : []), [definition]);
  const selected = rows.find((item) => item.node.id === selectedNodeId)?.node;

  const commit = (nextDefinition: LayoutDefinition, binding: LayoutBinding, targetSlides: Slide[] = [slide]) => {
    const definitions = updatedDefinitions(document, nextDefinition);
    const updates = targetSlides.map((target) => {
      const targetBinding = target.id === slide.id ? binding : autoBinding(nextDefinition, target);
      const plan = compileLayoutFramePlan(nextDefinition, targetBinding, target, document.pageSize);
      return { slideId: target.id, binding: targetBinding, elementFrames: plan.frames };
    });
    onCommand({ type: "apply-layout-plan", expectedRevision: { ...document.revisions }, definitions, slides: updates });
  };

  const createLayout = () => {
    const next = createStarterLayoutDefinition();
    commit(next, autoBinding(next, slide));
    setSelectedNodeId(next.tree.root.id);
  };

  const updateNode = (patch: Parameters<typeof updateLayoutNode>[2]) => {
    if (!definition || !slide.layoutBinding || !selected) return;
    const next = { ...definition, tree: updateLayoutNode(definition.tree, selected.id, patch) };
    commit(next, slide.layoutBinding);
  };

  const drop = (event: DragEvent, parent: LayoutNode) => {
    event.preventDefault();
    if (!definition || !slide.layoutBinding || !draggedNodeId || parent.type === "slot") return;
    try {
      const tree = moveLayoutNode(definition.tree, draggedNodeId, parent.id, parent.children.length);
      commit({ ...definition, tree }, slide.layoutBinding);
    } finally {
      setDraggedNodeId(undefined);
    }
  };

  const propose = () => {
    const base = definition ?? createStarterLayoutDefinition("AI 建议布局");
    const body = flatten(base.tree.root).map((item) => item.node).find((node) => node.type === "slot" && node.role === "body");
    const tree = body ? updateLayoutNode(base.tree, body.id, { height: fraction(5) }) : base.tree;
    setProposal({ definition: { ...base, tree }, summary: ["正文槽位获得更多垂直空间", "保留标题与正文内容绑定", "不修改任何已审核文案"] });
  };

  return (
    <section className="layout-tree-panel" aria-label="布局树与属性">
      <button type="button" className="layout-tree-heading" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown /> : <ChevronRight />}
        <LayoutTemplate />
        <strong>布局树</strong>
        <span>{rows.length || "未启用"}</span>
      </button>
      {open && (
        <div className="layout-tree-body">
          {!definition || !slide.layoutBinding ? (
            <button type="button" className="primary" onClick={createLayout}>为本页启用自动布局</button>
          ) : (
            <>
              <div className="layout-tree-toolbar">
                <select
                  aria-label="布局模板"
                  value={definition.id}
                  onChange={(event) => {
                    const next = document.layoutDefinitions?.find((item) => item.id === event.target.value);
                    if (next) commit(next, autoBinding(next, slide));
                  }}
                >
                  {(document.layoutDefinitions ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button type="button" title="AI 布局建议" onClick={propose}><Bot />建议</button>
              </div>
              <div className="layout-tree" role="tree">
                {rows.map(({ node, depth }) => (
                  <button
                    type="button"
                    role="treeitem"
                    aria-selected={selectedNodeId === node.id}
                    draggable={node.type !== "canvas"}
                    key={node.id}
                    className={selectedNodeId === node.id ? "active" : ""}
                    style={{ paddingInlineStart: 10 + depth * 16 }}
                    onClick={() => setSelectedNodeId(node.id)}
                    onDragStart={() => setDraggedNodeId(node.id)}
                    onDragOver={(event) => node.type !== "slot" && event.preventDefault()}
                    onDrop={(event) => drop(event, node)}
                  >
                    <span>{node.type}</span>
                    {node.type === "slot" && <small>{node.role}</small>}
                    <em>{node.layoutState}</em>
                  </button>
                ))}
              </div>
              {selected && (
                <div className="layout-node-properties">
                  <strong>节点属性</strong>
                  <label>宽度比例<input type="number" min="1" max="100" value={selected.width.mode === "fraction" ? selected.width.weight : 1} onChange={(event) => updateNode({ width: fraction(Number(event.target.value)) })} /></label>
                  <label>高度比例<input type="number" min="1" max="100" value={selected.height.mode === "fraction" ? selected.height.weight : 1} onChange={(event) => updateNode({ height: fraction(Number(event.target.value)) })} /></label>
                  {selected.type !== "slot" && <label>间距<select value={selected.gap ?? "md"} onChange={(event) => updateNode({ gap: event.target.value as "xs" | "sm" | "md" | "lg" | "xl" })}>{["xs", "sm", "md", "lg", "xl"].map((value) => <option key={value}>{value}</option>)}</select></label>}
                  <button type="button" onClick={() => {
                    if (!definition || !slide.layoutBinding) return;
                    const binding = detachedOverride(slide.layoutBinding, selected.id);
                    const plan = compileLayoutFramePlan(definition, binding, slide, document.pageSize);
                    onCommand({ type: "apply-layout-plan", expectedRevision: { ...document.revisions }, definitions: document.layoutDefinitions ?? [], slides: [{ slideId: slide.id, binding, elementFrames: plan.frames }] });
                  }}><Unlink />脱离自动布局</button>
                </div>
              )}
              <button type="button" onClick={() => commit(definition, slide.layoutBinding!, document.slides)}>应用到全稿</button>
            </>
          )}
          {proposal && (
            <div className="layout-proposal" role="status">
              <strong>AI 提案差异</strong>
              <ul>{proposal.summary.map((item) => <li key={item}>{item}</li>)}</ul>
              <div><button type="button" onClick={() => setProposal(undefined)}>取消</button><button type="button" className="primary" onClick={() => { const binding = slide.layoutBinding?.definitionId === proposal.definition.id ? slide.layoutBinding : autoBinding(proposal.definition, slide); commit(proposal.definition, binding); setProposal(undefined); }}>确认应用</button></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

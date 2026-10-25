import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChartColumn,
  Circle,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus2,
  FilePenLine,
  FolderClock,
  FileUp,
  Grid2x2,
  Grid3x3,
  ImagePlus,
  LayoutDashboard,
  Magnet,
  Minus,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Palette,
  Play,
  Plus,
  Redo2,
  Save,
  SaveAll,
  Scissors,
  Search,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  Wand2,
} from "lucide-react";

import { type AnimationEffect, type SlideAnimation } from "../core/document-model";

import { TextFormatToolbar } from "../features/editor/TextFormatToolbar";

import { PageSizeControls } from "../features/editor/PageSizeControls";
import { ShapePicker } from "../features/editor/ShapePicker";
import { ArrangeToolbar } from "../features/editor/ArrangeToolbar";

import { ANIMATION_EFFECT_OPTIONS, ANIMATION_PHASE_LABELS } from "../features/editor/animation-options";

import { isDesktopRuntime } from "../services/project-files";

import { ToolButton } from "../features/editor/ToolButton";

import type { AppRuntime } from "./app-runtime";

export function EditorRibbon({ app }: { app: AppRuntime }) {
  const {
    editorCanvasOpen,
    editorRibbonTab,
    setEditorRibbonTab,
    handleNew,
    handleOpenOrImport,
    setRecentProjectsOpen,
    refreshRecentProjects,
    saving,
    handleSave,
    handleSaveAs,
    handleRenameProject,
    handleDuplicateProject,
    undo,
    undoStack,
    redo,
    redoStack,
    execute,
    activeSlide,
    document,
    selectedElementIds,
    copySelection,
    clipboard,
    pasteSelection,
    setFindOpen,
    selectedTextElements,
    imageInputRef,
    setIconPickerOpen,
    setInsertTableOpen,
    setInsertChartOpen,
    setAiImageError,
    setAiImageOpen,
    aiImageBusy,
    handleImageFile,
    setTaskStatus,
    fitToWindow,
    gridEnabled,
    toggleGrid,
    gridSnapEnabled,
    toggleGridSnap,
    snapEnabled,
    toggleSnap,
    addGuide,
    clearGuidesOnSlide,
    activeGuides,
    changeActiveView,
    selected,
    selectedAnimation,
    previewSelectedAnimation,
    previewSlideAnimations,
    animationPreviews,
    stopAnimationPreview,
    newAnimationEffect,
    setNewAnimationEffect,
    setSelectedAnimationId,
    selectedAnimationIndex,
    exportBusy,
    handleExport,
    setExportPreflightOpen,
  } = app;

  return (
    <>
      {editorCanvasOpen && (
        <header className="topbar" data-ribbon-tab={editorRibbonTab}>
          <nav className="ribbon-tabs" aria-label="编辑功能区">
            {(
              [
                ["file", "文件"],
                ["home", "开始"],
                ["insert", "插入"],
                ["design", "设计"],
                ["arrange", "排列"],
                ["animation", "动画"],
                ["view", "视图"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={editorRibbonTab === id ? "active" : undefined}
                aria-current={editorRibbonTab === id ? "page" : undefined}
                onClick={() => setEditorRibbonTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="toolbar-group file-tools">
            <ToolButton label="新建项目" caption="新建" onClick={handleNew}>
              <FilePlus2 />
            </ToolButton>
            <ToolButton
              label="打开或导入 PPTD、PPTX、PPT"
              caption="打开"
              onClick={handleOpenOrImport}
              disabled={!isDesktopRuntime()}
            >
              <FileUp />
            </ToolButton>
            <ToolButton
              label="最近项目"
              caption="最近"
              onClick={() => {
                setRecentProjectsOpen(true);
                void refreshRecentProjects();
              }}
              disabled={!isDesktopRuntime()}
            >
              <FolderClock />
            </ToolButton>
            <ToolButton
              label={saving ? "正在保存" : "保存项目"}
              caption={saving ? "保存中" : "保存"}
              onClick={handleSave}
              disabled={saving}
            >
              <Save />
            </ToolButton>
            <ToolButton label="另存为" caption="另存" onClick={handleSaveAs} disabled={saving || !isDesktopRuntime()}>
              <SaveAll />
            </ToolButton>
            <ToolButton label="重命名项目" caption="重命名" onClick={handleRenameProject} disabled={saving}>
              <FilePenLine />
            </ToolButton>
            <ToolButton
              label="复制项目"
              caption="副本"
              onClick={handleDuplicateProject}
              disabled={saving || !isDesktopRuntime()}
            >
              <Copy />
            </ToolButton>
          </div>
          <div className="toolbar-group home-tools">
            <ToolButton label="撤销" onClick={undo} disabled={!undoStack.length}>
              <Undo2 />
            </ToolButton>
            <ToolButton label="重做" onClick={redo} disabled={!redoStack.length}>
              <Redo2 />
            </ToolButton>
            <span className="separator" />
            <ToolButton label="新建幻灯片" caption="新建页面" onClick={() => execute({ type: "add-slide" })}>
              <Plus />
            </ToolButton>
            <ToolButton
              label="复制当前幻灯片"
              caption="复制页面"
              onClick={() => execute({ type: "duplicate-slide", slideId: activeSlide.id })}
            >
              <Copy />
            </ToolButton>
            <ToolButton
              label="删除当前幻灯片"
              caption="删除页面"
              disabled={document.slides.length <= 1}
              onClick={() => execute({ type: "delete-slide", slideId: activeSlide.id })}
            >
              <Trash2 />
            </ToolButton>
            <span className="separator" />
            <div className="quick-edit-tools" role="group" aria-label="剪贴板与查找">
              <button
                type="button"
                aria-label="剪切所选对象"
                title="剪切（Ctrl+X）"
                disabled={
                  selectedElementIds.length === 0 ||
                  selectedElementIds.every((id) => activeSlide.elements.find((item) => item.id === id)?.locked)
                }
                onClick={() => copySelection(true)}
              >
                <Scissors />
              </button>
              <button
                type="button"
                aria-label="复制所选对象"
                title="复制（Ctrl+C）"
                disabled={
                  selectedElementIds.length === 0 ||
                  selectedElementIds.every((id) => activeSlide.elements.find((item) => item.id === id)?.locked)
                }
                onClick={() => copySelection(false)}
              >
                <Copy />
              </button>
              <button
                type="button"
                aria-label="粘贴剪贴板对象"
                title="粘贴（Ctrl+V）"
                disabled={clipboard.elements.length === 0}
                onClick={pasteSelection}
              >
                <ClipboardPaste />
              </button>
              <button
                type="button"
                aria-label="查找和替换"
                title="查找和替换（Ctrl+F）"
                onClick={() => setFindOpen(true)}
              >
                <Search />
              </button>
            </div>
            <ToolButton
              label="删除所选对象"
              caption="删除对象"
              disabled={
                selectedElementIds.length === 0 ||
                selectedElementIds.every((id) => activeSlide.elements.find((item) => item.id === id)?.locked)
              }
              onClick={() => {
                const elementIds = selectedElementIds.filter(
                  (id) => !activeSlide.elements.find((item) => item.id === id)?.locked,
                );
                if (elementIds.length) execute({ type: "delete-elements", slideId: activeSlide.id, elementIds });
              }}
            >
              <Trash2 />
            </ToolButton>
            <span className="separator" />
            <TextFormatToolbar slideId={activeSlide.id} elements={selectedTextElements} execute={execute} />
          </div>
          <div className="toolbar-group insert-tools">
            <ToolButton label="文本" onClick={() => execute({ type: "add-text", slideId: activeSlide.id })}>
              <Type />
            </ToolButton>
            <ToolButton
              label="矩形"
              onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "rectangle" })}
            >
              <Square />
            </ToolButton>
            <ToolButton
              label="椭圆"
              onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "ellipse" })}
            >
              <Circle />
            </ToolButton>
            <ShapePicker onPick={(shape) => execute({ type: "add-shape", slideId: activeSlide.id, shape })} />
            <ToolButton
              label="直线"
              onClick={() => execute({ type: "add-line", slideId: activeSlide.id, direction: "horizontal" })}
            >
              <Minus />
            </ToolButton>
            <ToolButton
              label="箭头"
              onClick={() => execute({ type: "add-line", slideId: activeSlide.id, direction: "diagonal" })}
            >
              <ArrowRight />
            </ToolButton>
            <ToolButton label="图片" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus />
            </ToolButton>
            <ToolButton label="图标" onClick={() => setIconPickerOpen(true)}>
              <Sparkles />
            </ToolButton>
            <ToolButton label="插入表格" caption="表格" onClick={() => setInsertTableOpen(true)}>
              <Table2 />
            </ToolButton>
            <ToolButton label="插入图表" caption="图表" onClick={() => setInsertChartOpen(true)}>
              <ChartColumn />
            </ToolButton>
            <ToolButton
              label="AI 配图"
              onClick={() => {
                setAiImageError(undefined);
                setAiImageOpen(true);
              }}
              disabled={aiImageBusy}
            >
              <Sparkles />
            </ToolButton>
            <input
              ref={imageInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                handleImageFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <ToolButton
              label="重排版式（保留手工对象/配图）"
              onClick={() => {
                execute({ type: "relayout-slide", slideId: activeSlide.id });
                setTaskStatus("已按当前内容重新应用版式，手工对象、配图和锁定对象已保留");
              }}
            >
              <Wand2 />
            </ToolButton>
          </div>
          <div className="toolbar-group assist-tools">
            <ToolButton label="适应窗口" onClick={fitToWindow}>
              <LayoutDashboard />
            </ToolButton>
            <ToolButton label={gridEnabled ? "关闭网格" : "显示网格"} onClick={toggleGrid}>
              <Grid3x3 />
            </ToolButton>
            <ToolButton label={gridSnapEnabled ? "关闭网格吸附" : "吸附到网格"} onClick={toggleGridSnap}>
              <Grid2x2 />
            </ToolButton>
            <ToolButton label={snapEnabled ? "关闭吸附" : "开启吸附"} onClick={toggleSnap}>
              <Magnet />
            </ToolButton>
            <ToolButton label="添加垂直参考线" onClick={() => addGuide("x", document.pageSize.width / 2)}>
              <MoveVertical />
            </ToolButton>
            <ToolButton label="添加水平参考线" onClick={() => addGuide("y", document.pageSize.height / 2)}>
              <MoveHorizontal />
            </ToolButton>
            <ToolButton
              label="清除本页参考线"
              onClick={() => clearGuidesOnSlide(activeSlide.id)}
              disabled={!activeGuides.length}
            >
              <Trash2 />
            </ToolButton>
          </div>
          <div className="toolbar-group design-tools">
            <ToolButton label="选择主题" onClick={() => changeActiveView("theme")}>
              <Palette />
            </ToolButton>
            <ToolButton
              label="重排当前页面"
              onClick={() => execute({ type: "relayout-slide", slideId: activeSlide.id })}
            >
              <Wand2 />
            </ToolButton>
            <span className="separator" />
            <PageSizeControls
              pageSize={document.pageSize}
              elements={document.slides.flatMap((slide) => slide.elements)}
              execute={execute}
            />
          </div>
          <div className="toolbar-group arrange-tools">
            <ToolButton
              label="复制所选对象"
              disabled={!selected || selected.locked}
              onClick={() =>
                selected && execute({ type: "duplicate-element", slideId: activeSlide.id, elementId: selected.id })
              }
            >
              <Copy />
            </ToolButton>
            <ToolButton
              label="上移一层"
              disabled={
                !selected ||
                selected.locked ||
                activeSlide.elements.indexOf(selected) >= activeSlide.elements.length - 1
              }
              onClick={() =>
                selected &&
                execute({
                  type: "reorder-element",
                  slideId: activeSlide.id,
                  elementId: selected.id,
                  toIndex: activeSlide.elements.indexOf(selected) + 1,
                })
              }
            >
              <ArrowUp />
            </ToolButton>
            <ToolButton
              label="下移一层"
              disabled={!selected || selected.locked || activeSlide.elements.indexOf(selected) <= 0}
              onClick={() =>
                selected &&
                execute({
                  type: "reorder-element",
                  slideId: activeSlide.id,
                  elementId: selected.id,
                  toIndex: activeSlide.elements.indexOf(selected) - 1,
                })
              }
            >
              <ArrowDown />
            </ToolButton>
            <ToolButton
              label="置于顶层"
              disabled={
                !selected ||
                selected.locked ||
                activeSlide.elements.indexOf(selected) >= activeSlide.elements.length - 1
              }
              onClick={() =>
                selected &&
                execute({
                  type: "reorder-element",
                  slideId: activeSlide.id,
                  elementId: selected.id,
                  toIndex: activeSlide.elements.length - 1,
                })
              }
            >
              <ArrowUp />
            </ToolButton>
            <ToolButton
              label="置于底层"
              disabled={!selected || selected.locked || activeSlide.elements.indexOf(selected) <= 0}
              onClick={() =>
                selected &&
                execute({ type: "reorder-element", slideId: activeSlide.id, elementId: selected.id, toIndex: 0 })
              }
            >
              <ArrowDown />
            </ToolButton>
            <span className="separator" />
            <ArrangeToolbar
              slideId={activeSlide.id}
              selected={activeSlide.elements.filter((element) => selectedElementIds.includes(element.id))}
              groups={activeSlide.groups}
              execute={execute}
            />
            <span className="separator" />
            <ToolButton
              label="删除所选对象"
              disabled={!selected || selected.locked}
              onClick={() =>
                selected && execute({ type: "delete-element", slideId: activeSlide.id, elementId: selected.id })
              }
            >
              <Trash2 />
            </ToolButton>
          </div>
          <div className="toolbar-group animation-tools">
            <ToolButton
              label="预览当前动画"
              caption="预览"
              disabled={!selectedAnimation}
              onClick={previewSelectedAnimation}
            >
              <MousePointer2 />
            </ToolButton>
            <ToolButton
              label="按顺序预览本页动画"
              caption="播放全部"
              disabled={!activeSlide.animations?.length}
              onClick={previewSlideAnimations}
            >
              <Play />
            </ToolButton>
            <ToolButton
              label="停止动画预览"
              caption="停止"
              disabled={!animationPreviews.length}
              onClick={stopAnimationPreview}
            >
              <Square />
            </ToolButton>
            <span className="separator" />
            <div className="animation-effect-picker">
              <select
                aria-label="动画效果"
                title="选择动画效果"
                value={newAnimationEffect}
                disabled={!selected || selected.locked}
                onChange={(event) => setNewAnimationEffect(event.target.value as AnimationEffect)}
              >
                {(["entrance", "emphasis", "exit"] as const).map((phase) => (
                  <optgroup key={phase} label={ANIMATION_PHASE_LABELS[phase]}>
                    {ANIMATION_EFFECT_OPTIONS.filter((option) => option.phase === phase).map((option) => (
                      <option key={option.effect} value={option.effect}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                disabled={!selected || selected.locked}
                onClick={() => {
                  if (!selected) return;
                  const option =
                    ANIMATION_EFFECT_OPTIONS.find((candidate) => candidate.effect === newAnimationEffect) ??
                    ANIMATION_EFFECT_OPTIONS[1]!;
                  setSelectedAnimationId(undefined);
                  execute({
                    type: "add-animation",
                    slideId: activeSlide.id,
                    elementId: selected.id,
                    animation: {
                      effect: option.effect,
                      start: "on-click",
                      durationMs: option.durationMs,
                      delayMs: 0,
                      direction: option.effect === "fly-in" ? "bottom" : "none",
                    },
                  });
                }}
              >
                添加
              </button>
            </div>
            <span className="separator" />
            <ToolButton
              label="删除所选对象的最后一个动画"
              caption="删除动画"
              disabled={
                !selected || !(activeSlide.animations ?? []).some((animation) => animation.elementId === selected.id)
              }
              onClick={() => {
                if (!selected) return;
                const animation = [...(activeSlide.animations ?? [])]
                  .reverse()
                  .find((item) => item.elementId === selected.id);
                if (animation)
                  execute({ type: "remove-animation", slideId: activeSlide.id, animationId: animation.id });
              }}
            >
              <Trash2 />
            </ToolButton>
            <ToolButton
              label="复制所选动画"
              caption="复制动画"
              disabled={!selectedAnimation}
              onClick={() => {
                if (!selectedAnimation) return;
                execute({
                  type: "duplicate-animation",
                  slideId: activeSlide.id,
                  animationId: selectedAnimation.id,
                });
              }}
            >
              <Copy />
            </ToolButton>
            {selectedAnimation && (
              <div className="animation-timing-controls" aria-label="动画计时与顺序">
                <label>
                  开始
                  <select
                    value={selectedAnimation.start}
                    onChange={(event) =>
                      execute({
                        type: "set-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        changes: { start: event.target.value as typeof selectedAnimation.start },
                      })
                    }
                  >
                    <option value="on-click">单击时</option>
                    <option value="with-previous">与上一动画同时</option>
                    <option value="after-previous">上一动画之后</option>
                  </select>
                </label>
                <label>
                  时长
                  <input
                    type="number"
                    min="0.1"
                    max="60"
                    step="0.1"
                    value={selectedAnimation.durationMs / 1000}
                    onChange={(event) =>
                      execute({
                        type: "set-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        changes: { durationMs: Math.round(Number(event.target.value) * 1000) },
                      })
                    }
                  />
                </label>
                <label>
                  延迟
                  <input
                    type="number"
                    min="0"
                    max="60"
                    step="0.1"
                    value={selectedAnimation.delayMs / 1000}
                    onChange={(event) =>
                      execute({
                        type: "set-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        changes: { delayMs: Math.round(Number(event.target.value) * 1000) },
                      })
                    }
                  />
                </label>
                {selectedAnimation.effect === "fly-in" && (
                  <label>
                    方向
                    <select
                      value={selectedAnimation.direction}
                      onChange={(event) =>
                        execute({
                          type: "set-animation",
                          slideId: activeSlide.id,
                          animationId: selectedAnimation.id,
                          changes: { direction: event.target.value as SlideAnimation["direction"] },
                        })
                      }
                    >
                      <option value="left">从左侧</option>
                      <option value="right">从右侧</option>
                      <option value="top">从顶部</option>
                      <option value="bottom">从底部</option>
                    </select>
                  </label>
                )}
                <div className="animation-order-controls" aria-label="调整动画顺序">
                  <button
                    type="button"
                    title="动画前移"
                    disabled={selectedAnimationIndex <= 0}
                    onClick={() =>
                      execute({
                        type: "move-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        toIndex: selectedAnimationIndex - 1,
                      })
                    }
                  >
                    <ArrowUp />
                  </button>
                  <button
                    type="button"
                    title="动画后移"
                    disabled={
                      selectedAnimationIndex < 0 || selectedAnimationIndex >= (activeSlide.animations?.length ?? 0) - 1
                    }
                    onClick={() =>
                      execute({
                        type: "move-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        toIndex: selectedAnimationIndex + 1,
                      })
                    }
                  >
                    <ArrowDown />
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className="export-button"
            onClick={() => (exportBusy ? void handleExport() : setExportPreflightOpen(true))}
          >
            <Download size={17} /> {exportBusy ? "取消导出" : "导出 PPTX"}
          </button>
        </header>
      )}
    </>
  );
}

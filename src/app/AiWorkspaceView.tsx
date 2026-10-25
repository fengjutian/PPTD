import { ArrowLeft, ArrowRight, Check, CircleAlert, RotateCcw, Sparkles, Upload, Wand2, X } from "lucide-react";

import { ContentReview } from "../features/ai/ContentReview";

import { FactPicker } from "../features/ai/FactPicker";

import type { AppRuntime } from "./app-runtime";

export function AiWorkspaceView({ app }: { app: AppRuntime }) {
  const {
    activeView,
    aiDraft,
    returnToAiStart,
    agentWorkflow,
    aiDraftBlockingIssues,
    aiDraftBlockHint,
    handleRegenerateDraft,
    aiRegenerating,
    aiDraftBlockReason,
    continueToTheme,
    aiHistory,
    openAiHistory,
    aiTopic,
    aiPolishing,
    aiBusy,
    handlePolishAiTopic,
    setAiTopic,
    aiMaterial,
    setAiMaterial,
    resetAiFacts,
    handleMaterialFile,
    aiExtracting,
    handleExtractFacts,
    aiFacts,
    aiExcludedFacts,
    setAiExcludedFacts,
    setAiFacts,
    aiSlideCount,
    setAiSlideCount,
    handleAiGenerate,
    aiProgress,
    aiGenerationLabel,
    aiGenerationPercent,
    aiOriginalDraft,
    activeDraftSlideIndex,
    aiSaveState,
    aiRestoreUndoSlideIds,
    aiContentUndo,
    aiContentRedo,
    selectAiDraftSlide,
    updateAiDraftTitle,
    updateAiSlide,
    updateAiVisualAsset,
    updateAiBlocks,
    updateAiChecks,
    updateAiSlideReviewed,
    reviewAllAiSlides,
    addAiSlide,
    duplicateAiSlide,
    deleteAiSlide,
    moveAiSlide,
    restoreAiSlide,
    undoRestoreAiSlide,
    openSlideRewrite,
    runTitleAssist,
    runNotesAssist,
    runSplitAssist,
    runDeckReview,
    imagePromptAssist,
    runImagePromptAssist,
    dismissImagePrompts,
    undoAiContent,
    redoAiContent,
  } = app;

  return (
    <>
      {activeView === "ai" && (
        <main className="feature-workspace ai-workspace">
          <header className="feature-header">
            <div>
              {aiDraft && (
                <button
                  type="button"
                  className="header-back-button"
                  aria-label="返回初始页面"
                  title="返回初始页面"
                  onClick={returnToAiStart}
                >
                  <ArrowLeft />
                </button>
              )}
              <Sparkles />
              <div>
                <h1>AI 内容工作台</h1>
                <p>生成并审核内容，确认后再套用 PPT 模板</p>
              </div>
            </div>
            <div className="feature-header-actions">
              <div className="workflow-steps" aria-label="制作流程">
                <span className={!aiDraft ? "active" : "done"} aria-current={!aiDraft ? "step" : undefined}>
                  {aiDraft ? <Check /> : "1"} 生成草稿
                </span>
                <i />
                <span className={aiDraft ? "active" : ""} aria-current={aiDraft ? "step" : undefined}>
                  2 编辑文字
                </span>
                <i />
                <span>3 上传模板</span>
              </div>
              <span className="agent-workflow-status" aria-live="polite">
                {agentWorkflow.label}
              </span>
              {aiDraft && (
                <div className="draft-header-actions">
                  {aiDraftBlockingIssues.length > 0 && (
                    <span className="draft-blocked-hint">
                      <CircleAlert />
                      {aiDraftBlockHint}
                    </span>
                  )}
                  <button
                    type="button"
                    className="secondary-action draft-regenerate-action"
                    title="用同一个主题重新生成整份草稿；生成期间当前内容不变，完成后可用撤销回到上一版"
                    onClick={() => void handleRegenerateDraft()}
                  >
                    {aiRegenerating ? <X /> : <RotateCcw />}
                    {aiRegenerating ? "取消重新生成" : "重新生成草稿"}
                  </button>
                  <button
                    className="primary-action"
                    title={aiRegenerating ? "正在重新生成整份草稿，完成后再确认内容" : aiDraftBlockReason}
                    disabled={Boolean(aiDraftBlockReason) || aiRegenerating}
                    onClick={continueToTheme}
                  >
                    确认内容，选择 PPT 模板
                    <ArrowRight />
                  </button>
                </div>
              )}
            </div>
          </header>
          {!aiDraft ? (
            <div className="ai-split">
              <aside className="ai-history">
                <div className="ai-history-heading">
                  <strong>制作历史</strong>
                  <span>{aiHistory.length} 个草稿</span>
                </div>
                {aiHistory.length === 0 ? (
                  <p className="ai-history-empty">还没有草稿</p>
                ) : (
                  aiHistory.map((entry) => (
                    <button type="button" key={entry.id} onClick={() => openAiHistory(entry)}>
                      <Sparkles />
                      <div>
                        <strong>{entry.draft.title}</strong>
                        <span>
                          {entry.draft.slides.length} 页 ·{" "}
                          {new Date(entry.updatedAt).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <p>{entry.topic}</p>
                      </div>
                    </button>
                  ))
                )}
              </aside>
              <div className="feature-scroll ai-plan-pane">
                <div className="ai-compose-card">
                  <div className="section-kicker">AI 内容规划</div>
                  <h2>你想制作什么演示文稿？</h2>
                  <p>描述主题、受众、场景和重点，AI 将生成演示简报、逐页计划和可编辑的结构化内容。</p>
                  <label>
                    <span className="topic-field-heading">
                      <span>主题与要求</span>
                      <button
                        type="button"
                        className="link-action topic-polish-action"
                        disabled={!aiTopic.trim() || aiPolishing || aiBusy}
                        onClick={() => void handlePolishAiTopic()}
                      >
                        <Wand2 />
                        {aiPolishing ? "润色中…" : "AI 润色"}
                      </button>
                    </span>
                    <textarea
                      value={aiTopic}
                      onChange={(event) => setAiTopic(event.target.value)}
                      placeholder="例如：为管理层制作一份产品战略汇报，突出增长机会和下一季度行动"
                    />
                  </label>
                  <label>
                    <span className="topic-field-heading">
                      <span>参考素材（可选）</span>
                      <span className="material-hint">粘贴原文，生成时逐页引用</span>
                    </span>
                    <textarea
                      className="material-input"
                      value={aiMaterial}
                      onChange={(event) => {
                        setAiMaterial(event.target.value);
                        resetAiFacts();
                      }}
                      maxLength={40000}
                      rows={5}
                      placeholder="粘贴年报、研报或会议纪要原文。AI 会先抽出可核对的事实，再按事实写稿；没有素材时不编造数字。"
                    />
                  </label>
                  <div className="material-tools">
                    <label className="link-action material-import">
                      <Upload />
                      导入 .txt / .md
                      <input
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        hidden
                        onChange={(event) => {
                          void handleMaterialFile(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="link-action"
                      disabled={!aiMaterial.trim() || aiExtracting || aiBusy}
                      onClick={() => void handleExtractFacts()}
                    >
                      <Wand2 />
                      {aiExtracting ? "抽取中…" : aiFacts ? "重新抽取事实" : "抽取事实"}
                    </button>
                  </div>
                  {aiFacts && (
                    <FactPicker
                      facts={aiFacts}
                      excluded={aiExcludedFacts}
                      onToggle={(id) =>
                        setAiExcludedFacts((current) => {
                          const next = new Set(current);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      onRemove={(id) => {
                        setAiFacts((current) => current?.filter((fact) => fact.id !== id));
                        setAiExcludedFacts((current) => {
                          const next = new Set(current);
                          next.delete(id);
                          return next;
                        });
                      }}
                    />
                  )}
                  <label className="slide-count-field">
                    页数
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={aiSlideCount}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAiSlideCount(value === "" ? "" : Math.max(1, Math.trunc(Number(value)) || 1));
                      }}
                      onBlur={() => {
                        if (aiSlideCount === "") setAiSlideCount(1);
                      }}
                    />
                  </label>
                  <button
                    className="primary-action"
                    disabled={!aiTopic.trim() || aiPolishing || aiSlideCount === "" || aiExtracting}
                    onClick={handleAiGenerate}
                  >
                    {aiBusy ? "取消生成" : "生成 PPT 草稿"}
                    <ArrowRight />
                  </button>
                  {aiBusy && aiProgress && (
                    <div className="ai-generation-progress" role="status" aria-live="polite">
                      <strong>{aiGenerationLabel}</strong>
                      <div
                        className="design-progress-track"
                        aria-label="AI 生成进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={aiGenerationPercent}
                        role="progressbar"
                      >
                        <i style={{ width: `${aiGenerationPercent}%` }} />
                      </div>
                      <span>生成中可随时点击“取消生成”停止本次任务</span>
                    </div>
                  )}
                  <small>生成结果通过结构化 Schema 校验，应用前不会修改当前文稿。</small>
                </div>
              </div>
            </div>
          ) : (
            <div className="feature-scroll draft-mode">
              <ContentReview
                draft={aiDraft}
                originalDraft={aiOriginalDraft.current}
                activeIndex={activeDraftSlideIndex}
                saveState={aiSaveState}
                restoreUndoSlideIds={aiRestoreUndoSlideIds}
                canUndo={aiContentUndo.current.length > 0}
                canRedo={aiContentRedo.current.length > 0}
                regenerating={aiRegenerating}
                regenerateProgress={aiProgress ? { label: aiGenerationLabel, percent: aiGenerationPercent } : undefined}
                onActiveIndexChange={selectAiDraftSlide}
                onDraftTitleChange={updateAiDraftTitle}
                onSlideFieldChange={updateAiSlide}
                onSlideVisualAssetChange={updateAiVisualAsset}
                onSlideBlocksChange={updateAiBlocks}
                onSlideChecksChange={updateAiChecks}
                onSlideReviewedChange={updateAiSlideReviewed}
                onReviewAllSlides={reviewAllAiSlides}
                onAddSlide={addAiSlide}
                onDuplicateSlide={duplicateAiSlide}
                onDeleteSlide={deleteAiSlide}
                onMoveSlide={moveAiSlide}
                onRestoreSlide={restoreAiSlide}
                onUndoRestore={undoRestoreAiSlide}
                onRewriteSlide={openSlideRewrite}
                onSuggestTitle={(index) => void runTitleAssist(index)}
                onWriteNotes={(index) => void runNotesAssist(index)}
                onSplitSlide={(index) => void runSplitAssist(index)}
                onReviewDeck={() => void runDeckReview()}
                imagePromptAssist={imagePromptAssist}
                onSuggestImagePrompts={(index) => void runImagePromptAssist(index)}
                onDismissImagePrompts={dismissImagePrompts}
                onUndo={undoAiContent}
                onRedo={redoAiContent}
              />
            </div>
          )}
        </main>
      )}
    </>
  );
}

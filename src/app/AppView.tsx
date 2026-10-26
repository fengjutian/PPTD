import { Layers3, LayoutDashboard, Palette, ScrollText, Settings, Sparkles } from "lucide-react";

import { LogPanel } from "../features/diagnostics/LogPanel";

import { ContentReviewStatus } from "../features/editor/ContentReviewStatus";

import { SettingsWorkspace } from "../features/settings/SettingsDialog";

import { removeRecentProject } from "../services/app-database";

import { isDesktopRuntime } from "../services/project-files";

import { ProjectHome } from "./ProjectHome";
import type { AppRuntime } from "./app-runtime";
import { EditorRibbon } from "./EditorRibbon";
import { EditorWorkspaceView } from "./EditorWorkspaceView";
import { AiWorkspaceView } from "./AiWorkspaceView";
import { ThemeWorkspaceView } from "./ThemeWorkspaceView";
import { StyleWorkspaceView } from "./StyleWorkspaceView";
import { DialogStack } from "./DialogStack";

export function AppView({ app }: { app: AppRuntime }) {
  const {
    t,
    activeView,
    changeActiveView,
    diagnosticsOpen,
    openDiagnostics,
    uiLanguage,
    logRecords,
    logLoading,
    logLocation,
    loadDiagnostics,
    setDiagnosticsOpen,
    editorSurface,
    projectHomeItems,
    designBusy,
    generatingHistoryId,
    designProgress,
    handleOpenOrImport,
    handleNew,
    openAiPresentation,
    removeAiHistoryEntry,
    handleOpenRecent,
    setRecentProjects,
    setTaskStatus,
    setUiLanguage,
    aiDraft,
    activeDraftSlideIndex,
    aiDraftMetrics,
    aiSaveState,
    aiHistory,
    document,
    activeSlide,
    execute,
    setContentHistoryOpen,
    countLabel,
    revisionLabel,
    missingImageCount,
    dirty,
    setZoom,
    fitToWindow,
    zoom,
    editorCanvasOpen,
    inspectorWidth,
  } = app;

  return (
    <div
      className={`app-shell ${editorCanvasOpen ? "" : "module-shell"}`}
      style={{ "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties}
    >
      <EditorRibbon app={app} />

      <nav className="nav-rail" aria-label={t("shell.navAria")}>
        <button
          className={activeView === "editor" ? "active" : ""}
          aria-current={activeView === "editor" ? "page" : undefined}
          title={t("shell.editorTitle")}
          onClick={() => changeActiveView("editor")}
        >
          <LayoutDashboard />
          <span>{t("shell.editor")}</span>
        </button>
        <button
          className={activeView === "ai" ? "active" : ""}
          aria-current={activeView === "ai" ? "page" : undefined}
          title={t("shell.aiTitle")}
          onClick={() => changeActiveView("ai")}
          disabled={!isDesktopRuntime()}
        >
          <Sparkles />
          <span>{t("shell.ai")}</span>
        </button>
        <button
          className={activeView === "style" ? "active" : ""}
          aria-current={activeView === "style" ? "page" : undefined}
          title={t("shell.styleTitle")}
          onClick={() => changeActiveView("style")}
        >
          <Layers3 />
          <span>{t("shell.style")}</span>
        </button>
        <button
          className={activeView === "theme" ? "active" : ""}
          aria-current={activeView === "theme" ? "page" : undefined}
          title={t("shell.themeTitle")}
          onClick={() => changeActiveView("theme")}
        >
          <Palette />
          <span>{t("shell.theme")}</span>
        </button>
        <button
          className={diagnosticsOpen ? "active" : ""}
          aria-expanded={diagnosticsOpen}
          aria-haspopup="dialog"
          title={t("shell.logTitle")}
          onClick={openDiagnostics}
        >
          <ScrollText />
          <span>{t("shell.log")}</span>
        </button>
        <div className="nav-spacer" />
        <button
          className={activeView === "settings" ? "active" : ""}
          aria-current={activeView === "settings" ? "page" : undefined}
          title={t("shell.settings")}
          onClick={() => changeActiveView("settings")}
        >
          <Settings />
          <span>{t("shell.settings")}</span>
        </button>
      </nav>

      {diagnosticsOpen && (
        <LogPanel
          language={uiLanguage}
          records={logRecords}
          loading={logLoading}
          location={logLocation}
          onRefresh={() => void loadDiagnostics()}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}

      {activeView === "editor" && editorSurface === "projects" && (
        <ProjectHome
          items={projectHomeItems}
          designBusy={designBusy}
          generatingHistoryId={generatingHistoryId}
          designProgress={designProgress}
          onOpenOrImport={() => void handleOpenOrImport()}
          onNew={() => void handleNew()}
          onOpenAi={(entry) => void openAiPresentation(entry)}
          onRemoveAi={removeAiHistoryEntry}
          onOpenRecent={(entry) => void handleOpenRecent(entry)}
          onRemoveRecent={(entry) => {
            void removeRecentProject(entry.path)
              .then(setRecentProjects)
              .catch((error: unknown) =>
                setTaskStatus(`移除失败：${error instanceof Error ? error.message : String(error)}`),
              );
          }}
        />
      )}
      <EditorWorkspaceView app={app} />

      <AiWorkspaceView app={app} />

      <StyleWorkspaceView app={app} />

      <ThemeWorkspaceView app={app} />

      {activeView === "settings" && (
        <main className="feature-workspace settings-workspace">
          <header className="feature-header">
            <div>
              <Settings />
              <div>
                <h1>{t("settings.title")}</h1>
                <p>{t("settings.description")}</p>
              </div>
            </div>
          </header>
          <div className="feature-scroll">
            <SettingsWorkspace language={uiLanguage} onLanguageChange={setUiLanguage} onMessage={setTaskStatus} />
          </div>
        </main>
      )}

      <DialogStack app={app} />

      <footer className="statusbar">
        {activeView === "editor" && editorSurface === "projects" ? (
          <>
            <span>项目首页</span>
            <span>{projectHomeItems.length > 0 ? `${projectHomeItems.length} 个最近项目` : "尚无最近项目"}</span>
            <span className="saved-dot">● 最近编辑项目优先</span>
          </>
        ) : activeView === "ai" ? (
          aiDraft ? (
            <>
              <span>
                草稿第 {activeDraftSlideIndex + 1} / {aiDraft.slides.length} 页
              </span>
              <span>{aiDraftMetrics.characters} 字</span>
              <span>{aiDraftMetrics.points} 条要点</span>
              <span className={`saved-dot ${aiSaveState === "saving" ? "dirty" : ""}`}>
                ● {aiSaveState === "saving" ? "保存中…" : "已自动保存"}
              </span>
            </>
          ) : (
            <>
              <span>AI 内容工作台</span>
              <span>填写主题后生成结构化草稿</span>
              <span className="saved-dot">
                ● {aiHistory.length > 0 ? `${aiHistory.length} 个历史草稿` : "尚未生成草稿"}
              </span>
            </>
          )
        ) : (
          <>
            <span>
              第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页
            </span>
            {activeView === "editor" && (
              <ContentReviewStatus slideId={activeSlide.id} status={activeSlide.content.status} onCommand={execute} />
            )}
            {activeView === "editor" && (
              <button
                type="button"
                className="content-history-open"
                title="查看已确认内容版本，并与当前内容逐页对比"
                onClick={() => setContentHistoryOpen(true)}
              >
                内容版本 {document.contentVersions?.length ?? 0}
              </button>
            )}
            <span>{countLabel}</span>
            <span>{revisionLabel}</span>
            {missingImageCount > 0 && (
              <span className="missing-assets" title="这些图片读不出来，画布上以斜纹块占位">
                ⚠ {missingImageCount} 张图片资源缺失
              </span>
            )}
            <span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span>
            <span className="zoom-controls">
              <button
                type="button"
                aria-label="缩小画布"
                onClick={() => setZoom((value) => Math.max(0.3, Math.round((value - 0.1) * 10) / 10))}
              >
                −
              </button>
              <button type="button" className="zoom" title="适应窗口" onClick={fitToWindow}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="放大画布"
                onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.1) * 10) / 10))}
              >
                ＋
              </button>
            </span>
          </>
        )}
      </footer>
    </div>
  );
}

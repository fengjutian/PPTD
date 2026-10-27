import { FolderClock, Trash2, X } from "lucide-react";

import { AiImageDialog } from "../features/editor/AiImageDialog";
import { InsertTableDialog } from "../features/editor/InsertTableDialog";
import { InsertChartDialog } from "../features/editor/InsertChartDialog";

import { removeRecentProject } from "../services/app-database";

import type { BuiltinIconName } from "../core/document-model";
import { IconPicker } from "../features/editor/IconPicker";

import type { AppRuntime } from "./app-runtime";
import { DesignCandidateDialog } from "./DesignCandidateDialog";

export function EditorDialogs({ app }: { app: AppRuntime }) {
  const {
    insertTableOpen,
    setInsertTableOpen,
    execute,
    activeSlide,
    setTaskStatus,
    insertChartOpen,
    setInsertChartOpen,
    aiImageOpen,
    aiImageBusy,
    aiImageError,
    setAiImageOpen,
    handleAiImageGenerate,
    iconPickerOpen,
    setIconPickerOpen,
    recentProjectsOpen,
    setRecentProjectsOpen,
    recentProjects,
    handleOpenRecent,
    setRecentProjects,
    designCandidateView,
    closeDesignCandidates,
    applyDesignCandidate,
  } = app;

  return (
    <>
      {insertTableOpen && (
        <InsertTableDialog
          onClose={() => setInsertTableOpen(false)}
          onInsert={(columns, rows) => {
            execute({ type: "add-table", slideId: activeSlide.id, columns, rows });
            setInsertTableOpen(false);
            setTaskStatus(`已插入 ${rows + 1} 行 × ${columns} 列表格`);
          }}
        />
      )}
      {insertChartOpen && (
        <InsertChartDialog
          onClose={() => setInsertChartOpen(false)}
          onInsert={(kind) => {
            execute({ type: "add-chart", slideId: activeSlide.id, kind });
            setInsertChartOpen(false);
            setTaskStatus("已插入图表；可在属性面板修改示例指标");
          }}
        />
      )}
      {aiImageOpen && (
        <AiImageDialog
          busy={aiImageBusy}
          error={aiImageError}
          onClose={() => setAiImageOpen(false)}
          onGenerate={(prompt, role) => void handleAiImageGenerate(prompt, role)}
        />
      )}
      {iconPickerOpen && (
        <IconPicker
          onClose={() => setIconPickerOpen(false)}
          onPick={(name: BuiltinIconName) => {
            execute({ type: "add-icon", slideId: activeSlide.id, name });
            setIconPickerOpen(false);
          }}
        />
      )}
      {recentProjectsOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRecentProjectsOpen(false);
          }}
        >
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="recent-projects-title">
            <div className="upload-dialog-heading">
              <div>
                <FolderClock />
                <div>
                  <h2 id="recent-projects-title">最近项目</h2>
                  <p>项目文件仍保存在原位置；这里仅保存最近访问记录。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭最近项目" onClick={() => setRecentProjectsOpen(false)}>
                <X />
              </button>
            </div>
            {recentProjects.length === 0 ? (
              <div className="template-empty">还没有保存或打开过项目</div>
            ) : (
              <div className="ai-history">
                {recentProjects.map((entry) => (
                  <div key={entry.path} className="recent-project-row">
                    <button
                      type="button"
                      className="recent-project-open"
                      disabled={entry.missing}
                      title={entry.path}
                      onClick={() => void handleOpenRecent(entry)}
                    >
                      <FolderClock />
                      <div>
                        <strong>{entry.title}</strong>
                        <span>{entry.missing ? "文件已移动或删除" : entry.path}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="recent-project-remove"
                      aria-label={`从最近项目移除 ${entry.title}`}
                      title="仅从最近项目移除，不删除文件"
                      onClick={() => {
                        void removeRecentProject(entry.path)
                          .then(setRecentProjects)
                          .catch((error: unknown) =>
                            setTaskStatus(`移除失败：${error instanceof Error ? error.message : String(error)}`),
                          );
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {designCandidateView && (
        <DesignCandidateDialog
          view={designCandidateView}
          onPick={applyDesignCandidate}
          onClose={closeDesignCandidates}
        />
      )}
    </>
  );
}

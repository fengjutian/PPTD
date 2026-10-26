import { FindReplaceBar } from "../features/editor/FindReplaceBar";

import { ImportModeDialog, ImportReportDialog } from "../features/editor/PptxImportDialogs";

import { ContentHistory } from "../features/editor/ContentHistory";

import type { AppRuntime } from "./app-runtime";

export function ImportDialogs({ app }: { app: AppRuntime }) {
  const {
    templateMenu,
    setTemplateMenu,
    handleRenameTemplate,
    handleDeleteTemplate,
    importChoice,
    importBusy,
    importProgress,
    handleCancelImport,
    setImportChoice,
    setTaskStatus,
    handleImportContent,
    handleExtractTemplate,
    importPreview,
    setImportPreview,
    handleConfirmImport,
    contentHistoryOpen,
    document,
    setContentHistoryOpen,
    restoreContentVersion,
    restoreContentVersionWithDesign,
    editorCanvasOpen,
    findOpen,
    setFindOpen,
    findFocus,
  } = app;

  return (
    <>
      {templateMenu && (
        <div
          className="template-menu-backdrop"
          role="presentation"
          onMouseDown={() => setTemplateMenu(undefined)}
          onContextMenu={(event) => {
            event.preventDefault();
            setTemplateMenu(undefined);
          }}
        >
          <div
            className="template-context-menu"
            role="menu"
            style={{ left: templateMenu.x, top: templateMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <strong>{templateMenu.template.name}</strong>
            <button type="button" role="menuitem" onClick={() => void handleRenameTemplate(templateMenu.template)}>
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void handleDeleteTemplate(templateMenu.template)}
            >
              删除
            </button>
          </div>
        </div>
      )}
      {importChoice && (
        <ImportModeDialog
          fileName={importChoice.name}
          busy={importBusy}
          progress={importProgress}
          onCancelImport={importProgress ? () => void handleCancelImport() : undefined}
          onClose={() => {
            setImportChoice(undefined);
            setTaskStatus("已取消打开");
          }}
          onImportContent={() => void handleImportContent()}
          onExtractTemplate={() => void handleExtractTemplate()}
        />
      )}
      {importPreview && (
        <ImportReportDialog
          fileName={importPreview.fileName}
          report={importPreview.report}
          onCancel={() => {
            setImportPreview(undefined);
            setTaskStatus("已取消导入，当前项目未改变");
          }}
          onConfirm={() => void handleConfirmImport()}
        />
      )}
      {contentHistoryOpen && (
        <ContentHistory
          document={document}
          onClose={() => setContentHistoryOpen(false)}
          onRestore={restoreContentVersion}
          onRestoreDesign={restoreContentVersionWithDesign}
        />
      )}
      {editorCanvasOpen && findOpen && <FindReplaceBar initialFocus={findFocus} onClose={() => setFindOpen(false)} />}
    </>
  );
}

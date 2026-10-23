import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ImportedDeck } from "../core/commands/pptx-import";

export interface PptxImportProgress {
  requestId: string;
  current: number;
  total: number;
  stage: string;
}

/**
 * Reads the content of a PPTX through the Rust Level A reader.
 *
 * The command is read-only: it never writes the source file. `requestId` scopes
 * the progress events and the cancel command to this one import. The caller
 * turns the result into a new in-memory document and must save it as a new
 * project.
 */
export async function importPptxContent(path: string, requestId: string): Promise<ImportedDeck> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  return invoke<ImportedDeck>("import_pptx_content", { path, requestId });
}

export async function cancelPptxImport(requestId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_pptx_import", { requestId });
}

export function listenPptxImportProgress(
  handler: (progress: PptxImportProgress) => void,
): Promise<UnlistenFn> {
  return listen<PptxImportProgress>("pptx-import-progress", (event) => handler(event.payload));
}

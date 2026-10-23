import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ImportedDeck } from "../core/commands/pptx-import";

/**
 * Reads the content of a PPTX through the Rust Level A reader.
 *
 * The command is read-only: it never writes the source file. The caller turns
 * the result into a new in-memory document and must save it as a new project.
 */
export async function importPptxContent(path: string): Promise<ImportedDeck> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  return invoke<ImportedDeck>("import_pptx_content", { path });
}

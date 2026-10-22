/// <reference lib="webworker" />

import { buildPptx, type ExportReport } from "./export-pptx";
import type { ExportIssue } from "../../core/validation/export-validation";
import type { PresentationDocument } from "../../core/document-model";

declare const self: DedicatedWorkerGlobalScope;

/**
 * The PPTX build runs here so the zip/unzip work of PptxGenJS and fflate never
 * blocks the editor thread. The preflight already ran on the main thread
 * (it needs the DOM font probe), so the worker only renders and packs.
 */
interface BuildRequest {
  type: "build";
  id: number;
  document: PresentationDocument;
  prevalidatedIssues: ExportIssue[];
}

interface CancelRequest {
  type: "cancel";
  id: number;
}

const controllers = new Map<number, AbortController>();

self.onmessage = async (event: MessageEvent<BuildRequest | CancelRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    controllers.get(message.id)?.abort();
    controllers.delete(message.id);
    return;
  }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  try {
    const { bytes, report } = await buildPptx(message.document, {
      signal: controller.signal,
      prevalidatedIssues: message.prevalidatedIssues,
    });
    controllers.delete(message.id);
    self.postMessage({ type: "done", id: message.id, bytes, report } satisfies {
      type: "done";
      id: number;
      bytes: Uint8Array;
      report: ExportReport;
    });
  } catch (error) {
    controllers.delete(message.id);
    self.postMessage({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

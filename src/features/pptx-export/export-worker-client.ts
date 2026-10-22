import type { PresentationDocument } from "../../core/document-model";
import type { ExportIssue } from "../../core/validation/export-validation";
import type { ExportReport } from "./export-pptx";

export interface ExportWorkerResult {
  bytes: Uint8Array;
  report: ExportReport;
}

interface PendingEntry {
  resolve: (result: ExportWorkerResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, PendingEntry>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: "done"; id: number; bytes: Uint8Array; report: ExportReport }
        | { type: "error"; id: number; message: string };
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.type === "done") entry.resolve({ bytes: message.bytes, report: message.report });
      else entry.reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      const message = event.message || "EXPORT_WORKER_FAILED";
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error(message));
      }
    };
  }
  return worker;
}

/**
 * Builds the PPTX in a background worker. The caller must pass the preflight
 * issues it computed on the main thread (the worker has no DOM font probe).
 */
export function buildPptxInWorker(
  document: PresentationDocument,
  prevalidatedIssues: ExportIssue[],
): { promise: Promise<ExportWorkerResult>; cancel: () => void } {
  const currentWorker = ensureWorker();
  const id = nextId++;
  const promise = new Promise<ExportWorkerResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  currentWorker.postMessage({ type: "build", id, document, prevalidatedIssues });
  return {
    promise,
    cancel: () => currentWorker.postMessage({ type: "cancel", id }),
  };
}

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
    const current = new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" });
    worker = current;
    current.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: "done"; id: number; bytes: Uint8Array; report: ExportReport }
        | { type: "error"; id: number; message: string };
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.type === "done") entry.resolve({ bytes: message.bytes, report: message.report });
      else entry.reject(new Error(message.message));
    };
    current.onerror = (event) => {
      failWorker(event.message || "EXPORT_WORKER_FAILED");
    };
    current.onmessageerror = () => failWorker("EXPORT_WORKER_MESSAGE_INVALID");
  }
  return worker;
}

/**
 * A crashed worker cannot be reused: `postMessage` to it never answers, so the
 * next export would wait forever. Terminate it, reject every pending build and
 * let the next call create a fresh worker.
 */
function failWorker(message: string): void {
  const dead = worker;
  worker = undefined;
  try {
    dead?.terminate();
  } catch {
    // A worker that already died has nothing to terminate.
  }
  for (const [id, entry] of pending) {
    pending.delete(id);
    entry.reject(new Error(message));
  }
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
    cancel: () => {
      // 取消要立刻结算 promise；只发消息给 Worker 的话，打包阶段（zip /
      // PptxGenJS 写入）不可中断，用户会看到“已取消”但文件仍然被写出。
      if (!pending.has(id)) return;
      failWorker("EXPORT_CANCELLED");
    },
  };
}

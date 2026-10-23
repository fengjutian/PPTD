import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "../../core/document-model";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("export worker client", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces a crashed worker so the next export does not hang", async () => {
    const { buildPptxInWorker } = await import("./export-worker-client");
    const first = buildPptxInWorker(createDocument(), []);
    const worker = FakeWorker.instances[0]!;
    const rejection = expect(first.promise).rejects.toThrow("EXPORT_WORKER_CRASHED");

    worker.onerror?.({ message: "EXPORT_WORKER_CRASHED" } as ErrorEvent);

    await rejection;
    expect(worker.terminated).toBe(true);

    // 第二次导出必须拿到一个新的 Worker；沿用死掉的实例会永远没有响应。
    buildPptxInWorker(createDocument(), []);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("settles the promise when the user cancels", async () => {
    const { buildPptxInWorker } = await import("./export-worker-client");
    const task = buildPptxInWorker(createDocument(), []);
    const worker = FakeWorker.instances[0]!;
    const rejection = expect(task.promise).rejects.toThrow("EXPORT_CANCELLED");

    task.cancel();

    await rejection;
    expect(worker.terminated).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./project-files", () => ({ isDesktopRuntime: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./project-files";
import {
  createLogPayload,
  errorCodeOf,
  recordAppError,
  recordAppLog,
} from "./app-log";

describe("errorCodeOf", () => {
  it("takes the stable prefix from a coded error", () => {
    expect(errorCodeOf(new Error("AI_DESIGN_JSON_INVALID: slides.2.layout 不是已知版式"))).toBe(
      "AI_DESIGN_JSON_INVALID",
    );
    expect(errorCodeOf(new Error("EXPORT_CANCELLED"))).toBe("EXPORT_CANCELLED");
  });

  it("falls back to a stable code when the message carries none", () => {
    expect(errorCodeOf(new Error("导出失败：磁盘已满"))).toBe("UNKNOWN_ERROR");
    expect(errorCodeOf("some plain string")).toBe("UNKNOWN_ERROR");
    expect(errorCodeOf(undefined)).toBe("UNKNOWN_ERROR");
  });
});

describe("createLogPayload", () => {
  const now = new Date("2026-10-25T06:00:00.000Z");

  it("keeps the fields a diagnosis needs", () => {
    expect(
      createLogPayload(
        { level: "error", code: "AI_CONCEPT_JSON_INVALID", message: "方向不足", context: { directions: 2 } },
        now,
      ),
    ).toEqual({
      level: "error",
      code: "AI_CONCEPT_JSON_INVALID",
      message: "方向不足",
      at: "2026-10-25T06:00:00.000Z",
      context: { directions: 2 },
    });
  });

  it("truncates a message that would turn the log into a copy of the draft", () => {
    const payload = createLogPayload(
      { level: "error", code: "AI_JSON_INVALID", message: "字".repeat(2_500) },
      now,
    );
    const message = payload.message as string;
    expect(message).toHaveLength(2_001);
    expect(message.endsWith("…")).toBe(true);
  });

  it("drops an oversized context instead of writing it", () => {
    const payload = createLogPayload(
      { level: "error", code: "X", message: "m", context: { body: "字".repeat(5_000) } },
      now,
    );
    expect(payload.context).toEqual({ truncated: true });
  });
});

describe("recordAppLog", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isDesktopRuntime).mockReset();
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
  });

  it("appends through the Tauri command in the desktop runtime", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await recordAppLog({ level: "warn", code: "AI_DIRECTIONS_INVALID", message: "只有 2 个方向" });

    expect(invoke).toHaveBeenCalledOnce();
    const [command, args] = vi.mocked(invoke).mock.calls[0]!;
    expect(command).toBe("append_app_log");
    const entry = (args as { entry: Record<string, unknown> }).entry;
    expect(entry.level).toBe("warn");
    expect(entry.code).toBe("AI_DIRECTIONS_INVALID");
    expect(typeof entry.at).toBe("string");
  });

  it("does nothing in the browser preview", async () => {
    vi.mocked(isDesktopRuntime).mockReturnValue(false);
    await recordAppLog({ level: "error", code: "X", message: "m" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("never throws when the log command itself fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("APP_LOG_WRITE_FAILED"));
    await expect(
      recordAppLog({ level: "error", code: "X", message: "m" }),
    ).resolves.toBeUndefined();
  });
});

describe("recordAppError", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
  });

  it("writes the stage, the error code and coarse counts only", async () => {
    await recordAppError("导出 PPTX", new Error("EXPORT_PACKAGE_INVALID: 缺少 ppt/presentation.xml"), {
      slides: 6,
    });

    const entry = (vi.mocked(invoke).mock.calls[0]![1] as { entry: Record<string, unknown> }).entry;
    expect(entry.code).toBe("EXPORT_PACKAGE_INVALID");
    expect(entry.message).toContain("导出 PPTX");
    expect(entry.message).toContain("缺少 ppt/presentation.xml");
    expect(entry.context).toEqual({ slides: 6 });
  });
});

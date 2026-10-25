import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogPanel } from "./LogPanel";
import { formatLogTime } from "./log-time";
import type { AppLogRecord } from "../../services/app-log";

const record = (overrides: Partial<AppLogRecord> = {}): AppLogRecord => ({
  at: "2026-10-25T06:00:00.000Z",
  level: "error",
  code: "AI_DESIGN_JSON_INVALID",
  message: "AI 设计生成: slides.2.layout 不是已知版式",
  ...overrides,
});

describe("formatLogTime", () => {
  it("renders an ISO timestamp in local time", () => {
    expect(formatLogTime("2026-10-25T06:00:00.000Z")).not.toBe("2026-10-25T06:00:00.000Z");
  });

  it("keeps the raw value when the timestamp cannot be parsed", () => {
    expect(formatLogTime("not-a-date")).toBe("not-a-date");
  });
});

describe("LogPanel", () => {
  it("lists the newest record first with its code, stage and counts", () => {
    const markup = renderToStaticMarkup(
      <LogPanel
        language="zh"
        loading={false}
        location={"C:\\Users\\demo\\AppData\\Local\\com.pptd.desktop\\logs\\app.log"}
        onRefresh={() => undefined}
        onClose={() => undefined}
        records={[
          record({ at: "2026-10-25T05:00:00.000Z", code: "AI_DIRECTIONS_INCOMPLETE", message: "只有 3 个方向" }),
          record({ at: "2026-10-25T06:00:00.000Z", code: "EXPORT_PACKAGE_INVALID", message: "缺少 presentation.xml" }),
        ]}
      />,
    );
    expect(markup).toContain("诊断日志");
    expect(markup).toContain("EXPORT_PACKAGE_INVALID");
    expect(markup).toContain("缺少 presentation.xml");
    expect(markup).toContain("app.log");
    // Newest first: the export failure appears before the earlier direction one.
    expect(markup.indexOf("EXPORT_PACKAGE_INVALID")).toBeLessThan(markup.indexOf("AI_DIRECTIONS_INCOMPLETE"));
  });

  it("explains the empty state instead of rendering a blank panel", () => {
    const markup = renderToStaticMarkup(
      <LogPanel language="zh" loading={false} onRefresh={() => undefined} onClose={() => undefined} records={[]} />,
    );
    expect(markup).toContain("还没有失败记录");
    expect(markup).toContain("浏览器预览模式没有本地日志");
  });

  it("shows the loading state while the file is being read", () => {
    const markup = renderToStaticMarkup(
      <LogPanel language="en" loading onRefresh={() => undefined} onClose={() => undefined} records={[]} />,
    );
    expect(markup).toContain("Reading…");
    expect(markup).toContain("Diagnostic log");
  });
});

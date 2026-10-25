import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogPanel } from "./LogPanel";
import { formatLogRecords } from "./log-text";
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

describe("formatLogRecords", () => {
  it("keeps the panel order and carries time, level, code, message and context", () => {
    const text = formatLogRecords(
      [
        record({
          at: "2026-10-25T07:00:00.000Z",
          code: "EXPORT_PACKAGE_INVALID",
          message: "缺少 presentation.xml",
        }),
        record({
          at: "2026-10-25T06:00:00.000Z",
          level: "warn",
          code: "AI_DIRECTIONS_INCOMPLETE",
          message: "只有 3 个方向",
          context: { received: 4, rendered: 3 },
        }),
      ],
      "C:\\Users\\demo\\AppData\\Local\\com.pptd.desktop\\logs\\app.log",
    );
    expect(text).toContain("PPTD diagnostics");
    expect(text).toContain("C:\\Users\\demo\\AppData\\Local\\com.pptd.desktop\\logs\\app.log");
    expect(text).toContain("WARN AI_DIRECTIONS_INCOMPLETE");
    expect(text).toContain("只有 3 个方向");
    expect(text).toContain('{"received":4,"rendered":3}');
    expect(text).toContain("ERROR EXPORT_PACKAGE_INVALID");
    // 复制文本与面板展示同序：最新的失败在前，方便直接贴给开发者。
    expect(text.indexOf("EXPORT_PACKAGE_INVALID")).toBeLessThan(text.indexOf("AI_DIRECTIONS_INCOMPLETE"));
  });

  it("omits the path and empty context instead of writing placeholders", () => {
    const text = formatLogRecords([record({ context: undefined })]);
    expect(text.startsWith("PPTD diagnostics")).toBe(true);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("{}");
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
    // 有记录时复制按钮可用，并且整段记录可以一次带走。
    expect(markup).toContain("复制全部诊断记录");
    expect(/<button[^>]*diagnostics-copy[^>]*>/.exec(markup)?.[0] ?? "").not.toContain("disabled");
    // Newest first: the export failure appears before the earlier direction one.
    expect(markup.indexOf("EXPORT_PACKAGE_INVALID")).toBeLessThan(markup.indexOf("AI_DIRECTIONS_INCOMPLETE"));
  });

  it("explains the empty state instead of rendering a blank panel", () => {
    const markup = renderToStaticMarkup(
      <LogPanel language="zh" loading={false} onRefresh={() => undefined} onClose={() => undefined} records={[]} />,
    );
    expect(markup).toContain("还没有失败记录");
    expect(markup).toContain("浏览器预览模式没有本地日志");
    // 没有记录就没有可复制的内容，按钮保持禁用而不是复制一段空文本。
    expect(/<button[^>]*diagnostics-copy[^>]*>/.exec(markup)?.[0] ?? "").toContain("disabled");
  });

  it("shows the loading state while the file is being read", () => {
    const markup = renderToStaticMarkup(
      <LogPanel language="en" loading onRefresh={() => undefined} onClose={() => undefined} records={[]} />,
    );
    expect(markup).toContain("Reading…");
    expect(markup).toContain("Diagnostic log");
  });
});

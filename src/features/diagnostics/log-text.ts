import type { AppLogRecord } from "../../services/app-log";
import { formatLogTime } from "./log-time";

/**
 * 把界面里看到的记录拍平成一段可直接粘贴的文字。
 *
 * 单独成文件的原因与 `log-time.ts` 相同：组件文件只导出组件。这里保留传入
 * 的顺序（面板按最新在前展示），不做二次排序；上下文按原文 JSON 追加，避免
 * 复制出来的内容与界面显示不一致。
 */
export function formatLogRecords(records: readonly AppLogRecord[], location?: string): string {
  const header = location ? `PPTD diagnostics\n${location}` : "PPTD diagnostics";
  const entries = records.map((record) => {
    const lines = [`${formatLogTime(record.at)} ${record.level.toUpperCase()} ${record.code}`, record.message];
    if (record.context) lines.push(JSON.stringify(record.context));
    return lines.join("\n");
  });
  return [header, ...entries].join("\n\n");
}

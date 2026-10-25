import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./project-files";

/**
 * 运行期错误日志。
 *
 * 生成、设计、导出或保存失败时，界面上只有一句话；应用关掉之后它就不存在
 * 了。这里把失败追加到桌面端的 JSONL 日志，让"上一次为什么失败"可以被复查，
 * 而不是只能等用户复述。
 *
 * 边界：
 *
 * 1. 只记录错误码、失败阶段和计数。用户正文、演讲备注、图片数据一律不进来，
 *    这些不是诊断信息，而且日志文件比项目文件更容易被随手转发。
 * 2. 记录失败绝不能影响业务：任何异常都被吞掉，调用方照常抛自己的错误。
 * 3. 浏览器预览没有 Tauri IPC，直接跳过，不报错也不排队。
 */

export type AppLogLevel = "info" | "warn" | "error";

export interface AppLogEntry {
  level: AppLogLevel;
  /** 稳定错误码，例如 `AI_DESIGN_JSON_INVALID`。 */
  code: string;
  message: string;
  /** 阶段、页数、方向数一类结构化计数；不得放正文。 */
  context?: Record<string, unknown>;
}

const MAX_CODE_CHARS = 80;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 4_000;

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

/**
 * 从错误里取出稳定错误码。
 *
 * 领域错误统一写成 `CODE` 或 `CODE: detail`；`describeAiError` 面向用户翻译
 * 之后仍保留这段前缀，所以同一段文字既能展示也能归档。
 */
export function errorCodeOf(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const match = /^([A-Z][A-Z0-9_]{2,63})(?::|$)/.exec(detail.trim());
  return match?.[1] ?? "UNKNOWN_ERROR";
}

/** 一条记录的实际载荷。抽出来便于测试，不需要真的走 IPC。 */
export function createLogPayload(entry: AppLogEntry, now: Date = new Date()): Record<string, unknown> {
  const serializedContext = entry.context === undefined ? undefined : JSON.stringify(entry.context);
  // 上下文超长说明调用方塞了不该塞的东西：保留"被截断"这个事实，不保留内容。
  const context =
    serializedContext === undefined
      ? undefined
      : serializedContext.length <= MAX_CONTEXT_CHARS
        ? entry.context
        : { truncated: true };
  return {
    level: entry.level,
    code: truncate(entry.code, MAX_CODE_CHARS),
    message: truncate(entry.message, MAX_MESSAGE_CHARS),
    at: now.toISOString(),
    ...(context === undefined ? {} : { context }),
  };
}

/** 记录一条日志。失败安静降级，永不抛出。 */
export async function recordAppLog(entry: AppLogEntry): Promise<void> {
  if (!isDesktopRuntime()) return;
  try {
    await invoke("append_app_log", { entry: createLogPayload(entry) });
  } catch {
    // 日志是诊断通道，不能反过来让生成、设计或导出失败。
  }
}

/**
 * 记录一次失败。`scope` 是用户能看懂的阶段名（如「导出 PPTX」），
 * 与错误码一起构成可 grep 的一行。
 */
export function recordAppError(scope: string, error: unknown, context?: Record<string, unknown>): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return recordAppLog({
    level: "error",
    code: errorCodeOf(error),
    message: `${scope}: ${detail}`,
    ...(context === undefined ? {} : { context }),
  });
}

/** 日志文件的位置，用于告诉用户/开发者去哪里取诊断文件。 */
export async function appLogLocation(): Promise<string | undefined> {
  if (!isDesktopRuntime()) return undefined;
  try {
    return await invoke<string>("app_log_location");
  } catch {
    return undefined;
  }
}

/** 界面里读到的一条记录，与 Rust 端 `AppLogRecord` 对应。 */
export interface AppLogRecord {
  at: string;
  level: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * 读最近的诊断记录。
 *
 * 读取失败返回空列表而不是抛出：面板是只读的诊断视图，不能因为日志文件坏
 * 掉就打不开，也不能把错误盖在主界面上。
 */
export async function readAppLog(limit = 200): Promise<AppLogRecord[]> {
  if (!isDesktopRuntime()) return [];
  try {
    const records = await invoke<AppLogRecord[]>("read_app_log", { limit });
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

/**
 * AI 厂商目录。
 *
 * 这里只登记"界面上需要知道"的厂商信息：标识、展示名、服务地址和可用模型。
 * 真正的调用由后端的 `src-tauri/src/ai` 端口层完成，新增厂商时两边各加一条登记。
 *
 * `defaultModel` 必须与后端对应适配器的 `default_model()` 保持一致。
 */
export interface AiProviderDescriptor {
  id: string;
  label: string;
  /** 英文界面使用的展示名；没有时回退到 `label`。 */
  labelEn?: string;
  baseUrl: string;
  defaultModel: string;
  models: readonly string[];
  modelNotes: Readonly<Record<string, string>>;
  /** 英文界面使用的模型说明；没有对应项时回退到 `modelNotes`。 */
  modelNotesEn?: Readonly<Record<string, string>>;
}

export const AI_PROVIDERS: readonly AiProviderDescriptor[] = [
  {
    id: "minimax",
    label: "MiniMax 中国区",
    labelEn: "MiniMax (China)",
    baseUrl: "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
    modelNotes: { "MiniMax-M3": "最新旗舰", "MiniMax-M2.7-highspeed": "高速版" },
    modelNotesEn: { "MiniMax-M3": "Latest flagship", "MiniMax-M2.7-highspeed": "High-speed" },
  },
];

export const DEFAULT_AI_PROVIDER_ID = AI_PROVIDERS[0]!.id;

export function findAiProvider(providerId: string): AiProviderDescriptor {
  return AI_PROVIDERS.find((provider) => provider.id === providerId) ?? AI_PROVIDERS[0]!;
}

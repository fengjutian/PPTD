import type { PresentationDocument, SlideLayoutCapabilities } from "../document-model";
import { RECIPE_SPECIMEN_VERSION } from "./recipe-specimens";

export interface DesignAuditReport {
  versions: {
    schema: number;
    recipeCatalog: string;
    specimenMatrix: string;
    theme?: string;
    template?: string;
  };
  components: Record<"text" | "image" | "shape" | "table" | "chart" | "group", number>;
  layouts: Array<{ name: string; capabilities?: SlideLayoutCapabilities; usedBySlides: number }>;
  recipes: { identified: string[]; coverage: number; note: string };
  degradations: Array<{ code: string; count: number; message: string }>;
}

export interface DesignAuditInput {
  nativeAnimationSkipped?: number;
  nativeGroupSkipped?: number;
  warnings?: readonly string[];
}

export function buildDesignAudit(document: PresentationDocument, input: DesignAuditInput = {}): DesignAuditReport {
  const components = { text: 0, image: 0, shape: 0, table: 0, chart: 0, group: 0 };
  for (const slide of document.slides) {
    for (const element of slide.elements) components[element.type] += 1;
  }
  const degradations: DesignAuditReport["degradations"] = [];
  if ((input.nativeAnimationSkipped ?? 0) > 0)
    degradations.push({
      code: "ANIMATION_NATIVE_SKIPPED",
      count: input.nativeAnimationSkipped!,
      message: "部分动画无法写入原生时间轴",
    });
  if ((input.nativeGroupSkipped ?? 0) > 0)
    degradations.push({
      code: "GROUP_NATIVE_SKIPPED",
      count: input.nativeGroupSkipped!,
      message: "部分组合因成员限制保持扁平",
    });
  if ((input.warnings?.length ?? 0) > 0)
    degradations.push({ code: "EXPORT_WARNING", count: input.warnings!.length, message: "导出过程中产生警告" });
  return {
    versions: {
      schema: document.schemaVersion,
      recipeCatalog: RECIPE_SPECIMEN_VERSION,
      specimenMatrix: RECIPE_SPECIMEN_VERSION,
      ...(document.theme?.name ? { theme: document.theme.name } : {}),
      ...(document.templateStyle?.templateHash || document.templateStyle?.name
        ? { template: document.templateStyle.templateHash ?? document.templateStyle!.name }
        : {}),
    },
    components,
    layouts: (document.layouts ?? []).map((layout) => ({
      name: layout.name,
      ...(layout.capabilities ? { capabilities: layout.capabilities } : {}),
      usedBySlides: document.slides.filter((slide) => slide.layoutId === layout.id).length,
    })),
    recipes: {
      identified: [],
      coverage: 0,
      note: "当前文档模型尚未持久化 recipeId；审计不根据对象几何猜测配方。",
    },
    degradations,
  };
}

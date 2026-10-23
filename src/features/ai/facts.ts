import type { SourceFact } from "../../services/ai-service";

/**
 * 本次生成真正会用的事实：清单减去被勾掉的编号，顺序保持不变。
 *
 * 勾选只影响这一次生成，不修改事实本身：被排除的条目仍留在清单里，用户可以
 * 再勾回来，也可以明确删掉。
 */
export function selectedFacts(facts: readonly SourceFact[], excluded: ReadonlySet<string>): SourceFact[] {
  return facts.filter((fact) => !excluded.has(fact.id));
}

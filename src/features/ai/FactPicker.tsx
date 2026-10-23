import type { SourceFact } from "../../services/ai-service";

export interface FactPickerProps {
  /** 从素材里抽取出的事实，已经编号。 */
  facts: readonly SourceFact[];
  /** 不参与本次生成的编号。 */
  excluded: ReadonlySet<string>;
  /** 切换一条事实是否参与生成。 */
  onToggle: (id: string) => void;
  /** 把一条事实从清单里删掉。 */
  onRemove: (id: string) => void;
}

/**
 * 事实清单的勾选与删除。
 *
 * 抽取由模型完成，但"哪条能用"是人的决定：模型可能把观点写成事实，也可能
 * 把同一指标拆成两条。生成前先把清单摆出来，比生成后再去正文里找哪句话不对
 * 便宜得多。
 */
export function FactPicker({ facts, excluded, onToggle, onRemove }: FactPickerProps) {
  if (facts.length === 0) return null;
  const included = facts.filter((fact) => !excluded.has(fact.id)).length;
  return (
    <div className="fact-picker" aria-label="素材事实">
      <div className="fact-picker-head">
        <strong>素材事实</strong>
        <span>
          {included}/{facts.length} 条将用于生成
        </span>
      </div>
      <ul>
        {facts.map((fact) => {
          const active = !excluded.has(fact.id);
          const meta = [fact.figure, fact.period, fact.source].filter(Boolean).join(" · ");
          return (
            <li key={fact.id} className={active ? undefined : "excluded"}>
              <input
                type="checkbox"
                aria-label={`使用事实 ${fact.id}`}
                checked={active}
                onChange={() => onToggle(fact.id)}
              />
              <div>
                <p>
                  <b>{fact.id}</b> {fact.statement}
                </p>
                {meta && <small>{meta}</small>}
              </div>
              <button
                type="button"
                className="link-action fact-remove"
                aria-label={`删除事实 ${fact.id}`}
                onClick={() => onRemove(fact.id)}
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

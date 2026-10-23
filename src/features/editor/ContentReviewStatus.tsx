import type { DocumentCommand } from "../../core/commands";
import type { ContentStatus, SlideId } from "../../core/document-model";

/** 编辑器状态栏里显示的内容审核状态。 */
const contentStatusLabels: Record<ContentStatus, string> = {
  draft: "内容草稿",
  review: "内容审核中",
  approved: "内容已确认",
  changed: "内容已变更",
  needs_review: "内容需重新审核",
};

/**
 * 状态的解释，而不是状态名的复述。
 *
 * 用户看到的下一件事是"我能不能导出"，所以这里直接说明那一页为什么还算
 * 未审核，以及确认之后会发生什么。
 */
const contentStatusHints: Record<ContentStatus, string> = {
  draft: "本页内容还没有审核。导出前请确认本页内容。",
  review: "本页正在审核。确认之后才算已确认内容。",
  approved: "本页内容已确认。改文字、数字或备注后会重新变成待确认。",
  changed: "本页已确认的内容被修改过。导出前请重新确认本页。",
  needs_review: "依赖的内容发生了变化，本页需要重新审核。",
};

const APPROVE_HINT = "确认本页内容已审核；确认后导出不再提示本页未审核";
const REOPEN_HINT = "退回审核；导出前会再次提示本页未确认";

/**
 * 内容复核闭环的入口。
 *
 * 内容改动后页面从 `approved` 变成 `changed`，导出预检会一直告警。没有这里
 * 的入口，用户唯一的出路是撤销改动——那等于删掉自己的工作。确认和退回都是
 * 内容域命令，进撤销栈，但不碰文字本身。
 */
export function ContentReviewStatus({
  slideId,
  status,
  onCommand,
}: {
  slideId: SlideId;
  status: ContentStatus;
  onCommand: (command: DocumentCommand) => void;
}) {
  const approved = status === "approved";
  return (
    <span className="content-review">
      <span className={`content-status ${approved ? "approved" : "pending"}`} title={contentStatusHints[status]}>
        {contentStatusLabels[status]}
      </span>
      {approved ? (
        <button
          type="button"
          className="content-review-action"
          title={REOPEN_HINT}
          onClick={() => onCommand({ type: "reopen-slide-content", slideId })}
        >
          退回审核
        </button>
      ) : (
        <button
          type="button"
          className="content-review-action approve"
          title={APPROVE_HINT}
          onClick={() => onCommand({ type: "approve-slide-content", slideId })}
        >
          确认本页内容
        </button>
      )}
    </span>
  );
}

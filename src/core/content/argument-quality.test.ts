import { describe, expect, it } from "vitest";
import { assessArgument, hasConcreteEvidence, matchChangeMarkers } from "./argument-quality";

const page = (overrides: Partial<Parameters<typeof assessArgument>[0]> = {}) => ({
  title: "组织架构调整与资源倾斜显示AI业务优先级已高于传统搜索",
  items: [
    "近年多次进行组织架构调整，AI相关业务被独立或前置",
    "高管汇报关系与考核权重明显向智能云、大模型、自动驾驶倾斜",
    "销售与商业化资源在内部预算分配中逐步让位于AI基础设施建设",
    "人员招聘与人才激励的重点明显向AI研发岗位集中",
    "组织层面的优先级重排是判断战略转型真实性的关键信号",
  ],
  hasComparison: false,
  hasTimeline: false,
  hasProcess: false,
  ...overrides,
});

describe("argument form checks", () => {
  it("flags a page that argues change but lists it as parallel points", () => {
    const issues = assessArgument(page());
    const change = issues.find((issue) => issue.kind === "change-as-list");
    expect(change?.severity).toBe("warning");
    expect(change?.message).toContain("5 条并列要点");
    expect(change?.message).toContain("前后两栏对比");
  });

  it("accepts the same points when the page carries a comparison or timeline block", () => {
    expect(assessArgument(page({ hasComparison: true })).some((issue) => issue.kind === "change-as-list")).toBe(false);
    expect(assessArgument(page({ hasTimeline: true })).some((issue) => issue.kind === "change-as-list")).toBe(false);
  });

  it("does not turn one turn of phrase into a change argument", () => {
    const issues = assessArgument(
      page({ title: "三条组织变化", items: ["逐步推进组织调整", "新增两个事业部", "管理层分工不变"] }),
    );
    expect(issues.some((issue) => issue.kind === "change-as-list")).toBe(false);
  });

  it("notes points that carry only judgement and degree words", () => {
    const issues = assessArgument(page());
    const evidence = issues.find((issue) => issue.kind === "no-concrete-evidence");
    expect(evidence?.severity).toBe("info");
    expect(evidence?.message).toContain("程度词");
  });

  it("stays quiet once the points carry something checkable", () => {
    const issues = assessArgument(
      page({
        title: "三条组织变化",
        items: ["2024 年智能云收入同比增长 12%", "研发人员占比升到 41%", "销售费用率降到 18%"],
      }),
    );
    expect(issues.some((issue) => issue.kind === "no-concrete-evidence")).toBe(false);
  });

  it("needs at least three points before judging the page", () => {
    expect(assessArgument(page({ items: ["近年逐步调整", "逐步让位"] }))).toEqual([]);
  });
});

describe("concrete evidence", () => {
  it("counts numbers, years, units and quoted sources", () => {
    expect(hasConcreteEvidence("2024 年云收入 320 亿元")).toBe(true);
    expect(hasConcreteEvidence("研发人员占比 41%")).toBe(true);
    expect(hasConcreteEvidence("据《2024 年报》，广告收入下滑")).toBe(true);
  });

  it("does not accept a vague time word as a time", () => {
    expect(hasConcreteEvidence("近年多次进行组织架构调整")).toBe(false);
    expect(hasConcreteEvidence("明显向智能云倾斜")).toBe(false);
  });

  it("finds the change markers of a sentence", () => {
    expect(matchChangeMarkers("资源逐步让位于AI基础设施")).toEqual(["逐步", "让位于"]);
  });
});

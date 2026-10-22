import { describe, expect, it } from "vitest";
import { analyzeTitle, describeTitleSkeleton, findRepeatedTitlePatterns } from "./title-quality";

describe("标题质量检测", () => {
  it("把栏目名和栏目名后缀判为模板化标题", () => {
    expect(analyzeTitle("现状").issues).toContain("column-name");
    expect(analyzeTitle("背景分析").issues).toContain("column-name");
    expect(analyzeTitle("目标概述").issues).toContain("column-name");
  });

  it("把由栏目名拼成的标题判为模板化标题", () => {
    const analysis = analyzeTitle("现状与挑战");
    expect(analysis.issues).toContain("column-composition");
    expect(analysis.labels.join()).toContain("栏目名");
  });

  it("把疑问句开头和空泛结尾判为模板化标题", () => {
    expect(analyzeTitle("如何提升交付效率").issues).toContain("question-lead");
    expect(analyzeTitle("数字化转型的意义").issues).toContain("empty-tail");
  });

  it("给结论式标题留下干净的结果", () => {
    const analysis = analyzeTitle("交付周期从六周缩短到两周");
    expect(analysis.issues).toEqual([]);
  });

  it("不给单段标题句式指纹", () => {
    // 单段标题之间没有可比的句法结构，拿它们互相比较没有意义。
    expect(analyzeTitle("交付周期缩短一半").skeleton).toBeUndefined();
  });

  it("按段数和连接词记录多段标题的句式指纹", () => {
    expect(analyzeTitle("现状与挑战").skeleton).toBe("2|与");
    expect(analyzeTitle("背景、现状与挑战").skeleton).toBe("3|、+与");
  });

  it("找出多页共用同一个句式的标题", () => {
    const patterns = findRepeatedTitlePatterns([
      "增长放缓与利润承压",
      "获客成本上升与转化下滑",
      "团队扩张与交付放缓",
      "交付周期从六周缩短到两周",
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.indexes).toEqual([0, 1, 2]);
  });

  it("不把只有两页相同的句式当成重复", () => {
    const patterns = findRepeatedTitlePatterns(["增长放缓与利润承压", "获客成本上升与转化下滑", "结论页"]);
    expect(patterns).toEqual([]);
  });

  it("把句式指纹翻成人能读的说明", () => {
    expect(describeTitleSkeleton("2|与")).toContain("与");
    expect(describeTitleSkeleton("3|、+与")).toContain("、");
  });
});

import { analyzeTitle } from "../src/core/content/title-quality";

// 真实整册产出（2026-10-22，来自 live_deck_tests 的真实模型输出）。
const titles = [
  "Q2 营收达成预算目标,盈利能力出现结构性压力",
  "客流同比回暖未能完全对冲客单价下行",
  "主力品类贡献度提升,长尾 SKU 持续稀释整体毛利",
  "门店扩张节奏放缓,新老门店单店效率出现分化",
  "费用率管控见效,但毛利率收窄抵消了费用节约效果",
  "Q3 需以客单提升与品类治理为抓手稳定毛利结构",
];

for (const title of titles) {
  const analysis = analyzeTitle(title);
  const halfWidthComma = /[,;!?]/.test(title);
  const fullWidthIssues = /[!?]/.test(title);
  console.log(
    JSON.stringify({
      title,
      issues: analysis.issues,
      skeleton: analysis.skeleton,
      halfWidthComma,
      fullWidthIssues,
      segments: analysis.skeleton,
    }),
  );
}

// 统计：半角标点在中文里的普遍程度
const withHalf = titles.filter((t) => /[,;!?]/.test(t)).length;
console.log(`\n含半角标点的标题：${withHalf}/${titles.length}`);

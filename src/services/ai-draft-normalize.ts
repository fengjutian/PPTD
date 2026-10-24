/**
 * 把模型产出的草稿规范化。
 *
 * 规范化只做一件事：把中文语境里的半角标点换成全角。
 *
 * 它作用在**模型刚产出、用户还没看到**的文本上，不碰用户自己敲的字：
 * 用户敲的半角逗号是他自己的表达，替他改掉是越界；模型写的半角逗号是
 * 模型没写完的活儿，在交给用户审核之前收拾干净才对。
 *
 * 为什么要收拾：实测一整册六页的真实产出里，四页的标题写成
 * "Q2 营收达成预算目标,盈利能力出现结构性压力"。半角逗号夹在中文中间，
 * 整册看上去就是机器排的——这类毛病比配色难看更扎眼，因为它出现在每一页。
 *
 * 顺带解决了一个连带问题：半角逗号被词表当成了句式连接词，于是四页标题
 * 被判成"共用同一句法骨架"。标点规范化之后，连接词只剩真正的连接词
 * （与、和、及、以及），句式指纹不再被标点误伤。
 */

import { normalizeChinesePunctuation } from "../core/content/punctuation";
import type { AiDraft, ContentBlock } from "./ai-service";

/** 规范化一个内容块里的所有文字。 */
function normalizeBlock(block: ContentBlock): ContentBlock {
  switch (block.type) {
    case "paragraph":
      return { ...block, text: normalizeChinesePunctuation(block.text) };
    case "bullet-list":
      return { ...block, items: block.items.map(normalizeChinesePunctuation) };
    case "quote":
      return {
        ...block,
        text: normalizeChinesePunctuation(block.text),
        ...(block.attribution !== undefined ? { attribution: normalizeChinesePunctuation(block.attribution) } : {}),
      };
    case "metric":
      return { ...block, label: normalizeChinesePunctuation(block.label) };
    case "chart":
      return {
        ...block,
        categories: block.categories.map(normalizeChinesePunctuation),
        ...(block.series
          ? {
              series: block.series.map((item) => ({
                ...item,
                name: normalizeChinesePunctuation(item.name),
              })),
            }
          : {}),
        ...(block.unit !== undefined ? { unit: normalizeChinesePunctuation(block.unit) } : {}),
      };
    case "timeline":
    case "process":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          label: normalizeChinesePunctuation(item.label),
          text: normalizeChinesePunctuation(item.text),
        })),
      };
    case "comparison":
      return {
        ...block,
        leftLabel: normalizeChinesePunctuation(block.leftLabel),
        rightLabel: normalizeChinesePunctuation(block.rightLabel),
        leftItems: block.leftItems.map(normalizeChinesePunctuation),
        rightItems: block.rightItems.map(normalizeChinesePunctuation),
      };
    case "table-data":
      return {
        ...block,
        header: block.header.map(normalizeChinesePunctuation),
        rows: block.rows.map((row) => row.map(normalizeChinesePunctuation)),
      };
  }
}

/**
 * 规范化一整份草稿。
 *
 * 文稿标题、逐页标题、正文、备注、页面计划和内容块里的文字都过一遍。
 */
export function normalizeDraftPunctuation(draft: AiDraft): AiDraft {
  return {
    ...draft,
    title: normalizeChinesePunctuation(draft.title),
    slides: draft.slides.map((slide) => ({
      ...slide,
      title: normalizeChinesePunctuation(slide.title),
      body: normalizeChinesePunctuation(slide.body),
      speakerNotes: normalizeChinesePunctuation(slide.speakerNotes),
      ...(slide.plan
        ? {
            plan: {
              ...slide.plan,
              purpose: normalizeChinesePunctuation(slide.plan.purpose),
              conclusion: normalizeChinesePunctuation(slide.plan.conclusion),
              ...(slide.plan.visualAsset
                ? {
                    visualAsset: {
                      ...slide.plan.visualAsset,
                      prompt: normalizeChinesePunctuation(slide.plan.visualAsset.prompt),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(slide.blocks ? { blocks: slide.blocks.map(normalizeBlock) } : {}),
    })),
  };
}

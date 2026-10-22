/**
 * 中文标点规范化。
 *
 * 模型写中文时经常混用半角标点。实测一整册六页的真实产出里，四页的标题
 * 写成"Q2 营收达成预算目标,盈利能力出现结构性压力"——半角逗号夹在中文中间。
 * 这种页面一眼看上去就是机器排的：全篇的标点宽度不统一，中英文之间没有
 * 呼吸感，是"AI PPT 一眼假"里最容易被忽略却最扎眼的一项。
 *
 * 规范化不是无脑替换。英文句子里和数字千分位里的半角逗号必须原样保留：
 * "12,345" 不是标点，"Revenue, net" 也不是。判断依据是**相邻字符**：
 * 半角标点的两侧只要有一侧是中文，它就是中文语境里的标点，该转全角；
 * 两侧都是拉丁字母或数字，它就是西文语境里的标点，不该动。
 *
 * 规则表在 `assets/content-lexicon.json` 里，与生成提示共用同一份：
 * 提示要求模型用全角，检测端按同一张表看产出，两边不会各说各话。
 */

import lexicon from "../../../assets/content-lexicon.json";

/** 半角标点到全角标点的对照表。 */
const HALF_TO_FULL = lexicon.punctuation.halfWidthToFullWidth as Record<string, string>;

/** 成对标点的另一半。 */
const PAIRS = lexicon.punctuation.pairs as Record<string, string>;

/** 是不是中文字符（含中日韩统一表意文字与扩展 A）。 */
function isCjk(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff);
}

/**
 * 一个半角标点是不是处在中文语境里。
 *
 * 两侧只要有一侧是中文就算。这比"两侧都必须是中文"宽松，但更接近人的直觉：
 * "目标,盈利" 两侧都是中文；"盈利(target)" 左侧是中文、右侧不是，仍然该转；
 * "Revenue, net" 两侧都不是，不该转。
 */
function isInChineseContext(text: string, index: number): boolean {
  const before = text[index - 1];
  const after = text[index + 1];
  const beforeIsCjk = before !== undefined && isCjk(before);
  const afterIsCjk = after !== undefined && isCjk(after);
  return beforeIsCjk || afterIsCjk;
}

/**
 * 把一段中文文本里的半角标点转成全角。
 *
 * 只处理标点本身，不动文字内容：内容已经审核过，改字是越界。
 */
export function normalizeChinesePunctuation(text: string): string {
  if (!text) return text;
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const full = HALF_TO_FULL[character];
    if (!full || !isInChineseContext(text, index)) {
      result += character;
      continue;
    }
    // 括号成对时，右括号要跟着左括号一起转，否则"（abc)"会留在页面上。
    if (character === "(") {
      const close = PAIRS["("];
      const closeIndex = text.indexOf(close ?? ")", index + 1);
      if (closeIndex > 0 && isInChineseContext(text, closeIndex)) {
        result += full;
        continue;
      }
    }
    result += full;
  }
  return result;
}

/**
 * 文本里有没有混用半角标点。
 *
 * 检测端用它来提示"这一页的标点宽度不统一"。返回具体位置，
 * 让人知道是哪一处，而不是只得到一个笼统的警告。
 */
export function findHalfWidthPunctuation(text: string): Array<{ index: number; character: string; context: string }> {
  const found: Array<{ index: number; character: string; context: string }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (!HALF_TO_FULL[character]) continue;
    if (!isInChineseContext(text, index)) continue;
    const start = Math.max(0, index - 8);
    const end = Math.min(text.length, index + 9);
    found.push({ index, character, context: text.slice(start, end) });
  }
  return found;
}

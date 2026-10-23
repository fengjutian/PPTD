//! 内容词表。
//!
//! 词表是一份共享资产（仓库根目录的 `assets/content-lexicon.json`），
//! 前端的 `src/core/content/title-quality.ts` 读同一份文件做检测，
//! 这里读同一份文件写生成提示。两边各写一套规则，规则迟早会漂移：
//! 检测说某个标题没问题，提示却还在要求模型避免它。

use serde::Deserialize;

/// 词表文件。编译期内嵌，运行时不再依赖仓库里的路径。
const LEXICON_JSON: &str = include_str!("../../../../assets/content-lexicon.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LexiconFile {
    title_rules: TitleRules,
    argument_rules: ArgumentRules,
    punctuation: Punctuation,
    image_prompt: ImagePromptRules,
}

/// 论证形式：这一页在做哪种论证，以及它应该落到哪种内容块。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgumentForm {
    /// 写进提示的中文名。
    label: String,
    /// 与这种论证匹配的内容块。
    block: String,
    /// 判断这种论证的词。列表形式没有标记词。
    #[serde(default)]
    markers: Vec<String>,
}

/// 论证形式规则。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgumentRules {
    forms: Vec<ArgumentForm>,
    /// 只有程度、没有事实的词：通篇都是它们，说明这一页还没有证据。
    vague_intensifiers: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TitleRules {
    column_names: Vec<String>,
    column_suffixes: Vec<String>,
    banned_lead_phrases: Vec<String>,
    empty_tail_phrases: Vec<String>,
    connectors: Vec<String>,
}

/// 中文标点规则。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Punctuation {
    /// 半角标点到全角标点的对照表。
    half_width_to_full_width: std::collections::BTreeMap<String, String>,
}

/// 配图提示词的规则。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImagePromptRules {
    /// 提示词里不该出现的词：生成图里的文字几乎总是错的。
    text_request_words: Vec<String>,
    /// 整册配图的上限。
    max_images_per_deck: usize,
}

/// 标题规则。
#[derive(Debug, Clone)]
pub struct TitleLexicon {
    /// 栏目名：它们是表格的列头，不是结论。
    pub column_names: Vec<String>,
    /// 跟在栏目名后面的后缀。
    pub column_suffixes: Vec<String>,
    /// 疑问式开头。
    pub banned_lead_phrases: Vec<String>,
    /// 空泛的结尾。
    pub empty_tail_phrases: Vec<String>,
    /// 连接词。
    pub connectors: Vec<String>,
    /// 半角标点到全角标点的对照表。
    pub half_width_to_full_width: std::collections::BTreeMap<String, String>,
    /// 配图提示词里不该出现的词。
    pub image_text_request_words: Vec<String>,
    /// 整册配图的上限。
    pub max_images_per_deck: usize,
    argument_forms: Vec<ArgumentForm>,
    vague_intensifiers: Vec<String>,
}

impl TitleLexicon {
    /// 读取词表。词表是随代码一起编译进来的固定资产，解析失败说明构建坏了。
    pub fn load() -> Self {
        let file: LexiconFile = serde_json::from_str(LEXICON_JSON)
            .expect("内容词表必须能被解析：assets/content-lexicon.json");
        Self {
            column_names: file.title_rules.column_names,
            column_suffixes: file.title_rules.column_suffixes,
            banned_lead_phrases: file.title_rules.banned_lead_phrases,
            empty_tail_phrases: file.title_rules.empty_tail_phrases,
            connectors: file.title_rules.connectors,
            half_width_to_full_width: file.punctuation.half_width_to_full_width,
            image_text_request_words: file.image_prompt.text_request_words,
            max_images_per_deck: file.image_prompt.max_images_per_deck,
            argument_forms: file.argument_rules.forms,
            vague_intensifiers: file.argument_rules.vague_intensifiers,
        }
    }

    /// 配图纪律，写进内容生成提示。
    ///
    /// 配图意图在内容阶段就产出，用户在审核页看得见、改得动。所以这里要求
    /// 模型给的是**画面**，而不是"带标题的图"——生成图里的文字几乎总是错的。
    pub fn image_prompt_rules_prompt(&self) -> String {
        format!(
            "【配图意图】\n\
             1. plan.visualAsset 是可选的。只有这一页真的需要一张画面才能讲清楚时才输出，\
             不要每页都配图，整册最多 {} 张。\n\
             2. 格式：{{\"enabled\":true,\"prompt\":\"画面描述\",\"role\":\"hero|side|band\"}}。\n\
             3. prompt 只描述画面本身，不要出现文字、字母或数字（不要写{}）。\n\
             4. role 表示图在页面上的位置：hero 右侧整块，side 右下角一块，band 标题下一条。\n\
             5. 已经有时间线、对比、流程、表格或指标块的页面不要配图：那类页面版面已经满了。",
            self.max_images_per_deck,
            join_or(&self.image_text_request_words),
        )
    }

    /// 中文标点纪律，写进生成提示。
    ///
    /// 实测一整册六页的真实产出，四页标题写成"Q2 营收达成预算目标,盈利能力…"——
    /// 半角逗号夹在中文中间，整册看上去就是机器排的。要求模型写全角，
    /// 前端再按同一张表规范化，两边不会各说各话。
    pub fn punctuation_rules_prompt(&self) -> String {
        let pairs = self
            .half_width_to_full_width
            .iter()
            .map(|(half, full)| format!("{half} → {full}"))
            .collect::<Vec<_>>()
            .join("、");
        format!(
            "【中文标点】\n\
             1. 中文句子里的标点必须用全角：{pairs}。\n\
             2. 数字千分位、英文单词之间的半角标点保持原样（如 12,345、Revenue, net）。\n\
             3. 括号成对使用：中文语境用（），书名用《》，引文用“”。\n\
             4. 标题里不要出现标点堆叠，也不要用省略号断在半句中间。"
        )
    }

    /// 标题纪律，写进生成提示。
    ///
    /// 规则里的词全部来自词表，而不是在这里另写一份：词表改了，
    /// 提示里的词跟着改，检测与提示不会各说各话。
    pub fn title_rules_prompt(&self) -> String {
        format!(
            "【标题纪律】\n\
             1. 标题必须是一个可验证的结论，不得直接使用栏目名（如 {}），也不得把栏目名拼成标题（如 {}）。\n\
             2. 标题不得写成\"栏目名 + 后缀\"（如 {}）：那仍然是表格的列头，不是结论。\n\
             3. 标题不得以 {} 开头：标题要下判断，不能提问。\n\
             4. 标题不得以 {} 收尾：这种结尾没有告诉读者任何事。\n\
             5. 整套演示的标题不能共用同一个句法骨架。不要每页都写成 \"A与B\" 或 \"A、B与C\"，\
             段落数量和连接词要在整册里变化开。\n\
             6. 标题要能独立说明这一页的结论，不能靠读者看正文才知道它在讲什么。",
            join_or(&self.column_names),
            self.column_composition_examples(),
            self.column_suffix_examples(),
            join_or(&self.banned_lead_phrases),
            join_or(&self.empty_tail_phrases),
        )
    }

    /// 论证形式纪律，写进内容生成提示。
    ///
    /// 生成稿最常见的失败不是句子不通，而是每页都写成几条并列短句：
    /// 讲变化的页面没有"前"和"后"，讲对比的页面没有两侧。形式与内容块
    /// 不匹配，页面就没有论证，只剩排版。规则里的词全部来自共享词表，
    /// 前端检测读的是同一份。
    pub fn argument_rules_prompt(&self) -> String {
        let mut lines = vec![
            "【论证形式】".to_string(),
            "1. 写每一页之前，先判断它在做哪一种论证，再选与它匹配的内容块；形式与块不匹配，页面就会退化成没有信息量的并列短句。".to_string(),
        ];
        for (index, form) in self.argument_forms.iter().enumerate() {
            let condition = if form.markers.is_empty() {
                String::new()
            } else {
                format!(
                    "标题或要点里出现{}时，按这一条处理。",
                    join_or(&form.markers)
                )
            };
            lines.push(format!(
                "{}. {} → {}。{condition}",
                index + 2,
                form.label,
                form.block
            ));
        }
        let after_forms = self.argument_forms.len() + 2;
        lines.push(format!(
            "{after_forms}. bullet-list 的每一条必须是一个独立维度：任意两条互换位置后，读者读到的东西应当不同。"
        ));
        lines.push(format!(
            "{}. 每条要点必须能被核对：要么带数字、时间、主体或具体动作，要么明确写成判断。没有数据时写清缺哪项数据，不得用{}这类程度词冒充事实。",
            after_forms + 1,
            join_or(&self.vague_intensifiers)
        ));
        lines.push(format!(
            "{}. 自检：把一页要点的顺序打乱，如果读起来没有区别，说明它们在说同一件事，必须合并或拆页。",
            after_forms + 2
        ));
        lines.join("\n")
    }

    /// 用词表里的栏目名和后缀拼出反面例子。
    /// "现状分析"这种写法看起来像标题，其实只是列头加后缀，
    /// 所以栏目名和后缀必须成对出现在提示里，模型才知道要避开的是组合而不是单个词。
    fn column_suffix_examples(&self) -> String {
        let first = self.column_names.first().map(String::as_str).unwrap_or("");
        let suffix = self
            .column_suffixes
            .first()
            .map(String::as_str)
            .unwrap_or("");
        format!("\"{first}{suffix}\"")
    }

    /// 用词表里的词拼出一组反面例子。
    ///
    /// 例子比抽象规则更容易被模型照着避开，所以例子必须来自词表本身。
    fn column_composition_examples(&self) -> String {
        let names: Vec<&str> = self.column_names.iter().map(String::as_str).collect();
        let pair_connector = self.connectors.first().map(String::as_str).unwrap_or("与");
        let triple_connector = self.connectors.get(1).map(String::as_str).unwrap_or("、");
        let first = names.first().copied().unwrap_or("");
        let second = names.get(1).copied().unwrap_or("");
        let third = names.get(2).copied().unwrap_or("");
        format!(
            "\"{first}{pair_connector}{second}\"、\"{first}{triple_connector}{second}{pair_connector}{third}\"",
        )
    }
}

/// 把一组词连成顿号分隔的清单。
fn join_or(words: &[String]) -> String {
    if words.is_empty() {
        return "（无）".into();
    }
    words.join("、")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_shared_lexicon_file() {
        let lexicon = TitleLexicon::load();
        assert!(lexicon.column_names.iter().any(|word| word == "现状"));
        assert!(lexicon
            .banned_lead_phrases
            .iter()
            .any(|word| word == "如何"));
        assert!(lexicon
            .empty_tail_phrases
            .iter()
            .any(|word| word == "的意义"));
    }

    #[test]
    fn builds_the_title_rules_from_the_lexicon() {
        let lexicon = TitleLexicon::load();
        let prompt = lexicon.title_rules_prompt();
        // 提示里的词必须来自词表，而不是另写一份。
        assert!(prompt.contains("现状"));
        assert!(prompt.contains("如何"));
        assert!(prompt.contains("的意义"));
        assert!(prompt.contains("句法骨架"));
    }

    #[test]
    fn the_composition_examples_are_built_from_lexicon_words() {
        let lexicon = TitleLexicon::load();
        let examples = lexicon.column_composition_examples();
        let first = lexicon.column_names.first().expect("词表至少有一个栏目名");
        let second = lexicon.column_names.get(1).expect("词表至少有两个栏目名");
        assert!(examples.contains(first.as_str()));
        assert!(examples.contains(second.as_str()));
    }

    #[test]
    fn the_suffix_examples_pair_a_column_name_with_a_suffix() {
        let lexicon = TitleLexicon::load();
        let examples = lexicon.column_suffix_examples();
        let name = lexicon.column_names.first().expect("词表至少有一个栏目名");
        let suffix = lexicon.column_suffixes.first().expect("词表至少有一个后缀");
        assert!(examples.contains(name.as_str()));
        assert!(examples.contains(suffix.as_str()));
    }

    #[test]
    fn the_image_rules_come_from_the_lexicon() {
        let lexicon = TitleLexicon::load();
        let prompt = lexicon.image_prompt_rules_prompt();
        // 提示里的词必须来自词表：检测端用的就是同一批词。
        assert!(prompt.contains("文字"));
        assert!(prompt.contains(&lexicon.max_images_per_deck.to_string()));
        assert!(prompt.contains("画面"));
    }

    #[test]
    fn builds_the_argument_rules_from_the_lexicon() {
        let lexicon = TitleLexicon::load();
        let prompt = lexicon.argument_rules_prompt();
        assert!(prompt.contains("【论证形式】"));
        // 每种形式都要在提示里出现，且带着它对应的内容块。
        for form in &lexicon.argument_forms {
            assert!(prompt.contains(form.label.as_str()));
            assert!(prompt.contains(form.block.as_str()));
        }
        // 变化页不能写成并列要点：这是这套规则存在的原因。
        assert!(prompt.contains("不要写成 bullet-list"));
        // 程度词也来自词表，检测端读的是同一批。
        assert!(prompt.contains("明显"));
        assert!(prompt.contains("顺序打乱"));
    }

    #[test]
    fn the_change_form_is_marked_by_change_words() {
        let lexicon = TitleLexicon::load();
        let change = lexicon
            .argument_forms
            .iter()
            .find(|form| form.label.contains("变化"))
            .expect("词表必须有变化形式");
        assert!(change.markers.iter().any(|marker| marker == "逐步"));
        assert!(change.markers.iter().any(|marker| marker == "已高于"));
    }
}

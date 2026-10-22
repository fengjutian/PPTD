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
        }
    }

    /// 标题纪律，写进生成提示。
    ///
    /// 规则里的词全部来自词表，而不是在这里另写一份：词表改了，
    /// 提示里的词跟着改，检测与提示不会各说各话。
    pub fn title_rules_prompt(&self) -> String {
        format!(
            "【标题纪律】\n\
             1. 标题必须是一个可验证的结论，不得直接使用栏目名（如 {}），也不得把栏目名拼成标题（如 {}）。\n\
             2. 标题不得以 {} 开头：标题要下判断，不能提问。\n\
             3. 标题不得以 {} 收尾：这种结尾没有告诉读者任何事。\n\
             4. 整套演示的标题不能共用同一个句法骨架。不要每页都写成 \"A与B\" 或 \"A、B与C\"，\
             段落数量和连接词要在整册里变化开。\n\
             5. 标题要能独立说明这一页的结论，不能靠读者看正文才知道它在讲什么。",
            join_or(&self.column_names),
            self.column_composition_examples(),
            join_or(&self.banned_lead_phrases),
            join_or(&self.empty_tail_phrases),
        )
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
        assert!(lexicon.banned_lead_phrases.iter().any(|word| word == "如何"));
        assert!(lexicon.empty_tail_phrases.iter().any(|word| word == "的意义"));
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
}

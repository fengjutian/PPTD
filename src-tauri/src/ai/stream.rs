//! 厂商流式响应的增量解析。
//!
//! 解析器是纯函数：吃网络分片，吐出助手正文的增量片段。这样厂商协议的变化
//! 只影响这一个文件，而且可以用固定样例直接测。
//!
//! 兼容 OpenAI 风格的 SSE：每个 `data:` 行是一段 JSON，正文在
//! `choices[0].delta.content`；`data: [DONE]` 表示结束。

/// 从 SSE 文本流里提取助手正文的增量片段。
#[derive(Default)]
pub struct SseParser {
    buffer: String,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// 吃掉一段网络数据，返回其中已经完整的消息增量。
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        let mut deltas = Vec::new();
        while let Some(position) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..position + 1).collect();
            if let Some(delta) = self.parse_line(&line) {
                deltas.push(delta);
            }
        }
        deltas
    }

    /// 收尾：处理末尾没有换行符的最后一行。
    pub fn finish(&mut self) -> Vec<String> {
        if self.buffer.trim().is_empty() {
            self.buffer.clear();
            return Vec::new();
        }
        let line = std::mem::take(&mut self.buffer);
        self.parse_line(&line).into_iter().collect()
    }

    fn parse_line(&self, line: &str) -> Option<String> {
        let line = line.trim();
        // 空行是事件分隔，冒号开头是注释或心跳。
        if line.is_empty() || line.starts_with(':') {
            return None;
        }
        let payload = line.strip_prefix("data:")?.trim();
        if payload.is_empty() || payload == "[DONE]" {
            return None;
        }
        let value: serde_json::Value = serde_json::from_str(payload).ok()?;
        // 流式正文在 delta 里；个别厂商在同一条流里混用完整消息结构。
        value
            .pointer("/choices/0/delta/content")
            .or_else(|| value.pointer("/choices/0/message/content"))
            .and_then(|content| content.as_str())
            .filter(|content| !content.is_empty())
            .map(|content| content.to_string())
    }
}

/// 估算已完成的页数。
///
/// 流式返回的是 JSON 文本，每个页面对象恰好带一个 `speakerNotes` 字段，数它出现
/// 多少次就得到"已经写到第几页"。这是进度提示用的估算，不参与任何内容判定。
pub fn estimate_completed_pages(content: &str) -> usize {
    content.matches("\"speakerNotes\"").count()
}

/// 估算已经完成设计的页数。
///
/// 设计结果的每个页面对象恰好带一个必填的 `visualNarrative` 字段，数它出现
/// 多少次就得到"设计写到第几页"。同样是进度提示用的估算，不参与任何判定。
pub fn estimate_completed_designs(content: &str) -> usize {
    content.matches("\"visualNarrative\"").count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_deltas_out_of_a_split_sse_stream() {
        let mut parser = SseParser::new();
        let mut deltas = Vec::new();
        for chunk in [
            "data: {\"choices\":[{\"delta\":{\"content\":\"岳\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"阳\"}}]}\n",
            "\ndata: {\"choices\":[{\"delta\":{\"content\":\"楼\"}}]}\n\n",
        ] {
            deltas.extend(parser.push(chunk));
        }
        deltas.extend(parser.finish());

        assert_eq!(deltas, vec!["岳", "阳", "楼"]);
    }

    #[test]
    fn ignores_heartbeats_completion_markers_and_empty_content() {
        let mut parser = SseParser::new();
        let deltas = parser.push(
            ": keep-alive\n\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\ndata: [DONE]\n\n",
        );

        assert!(deltas.is_empty());
    }

    #[test]
    fn keeps_a_partial_line_until_the_rest_arrives() {
        let mut parser = SseParser::new();

        assert!(parser
            .push("data: {\"choices\":[{\"delta\":{\"content\":\"半")
            .is_empty());
        let deltas = parser.push("句\"}}]}\n");

        assert_eq!(deltas, vec!["半句"]);
    }

    #[test]
    fn reads_a_final_line_without_a_newline() {
        let mut parser = SseParser::new();
        assert!(parser
            .push("data: {\"choices\":[{\"delta\":{\"content\":\"结尾\"}}]}")
            .is_empty());

        assert_eq!(parser.finish(), vec!["结尾"]);
    }

    #[test]
    fn survives_a_broken_frame_without_losing_the_following_ones() {
        let mut parser = SseParser::new();
        let deltas = parser
            .push("data: {not json}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n");

        assert_eq!(deltas, vec!["好"]);
    }

    #[test]
    fn counts_the_pages_that_are_already_written() {
        let content = "{\"slides\":[{\"title\":\"一\",\"speakerNotes\":\"n\"},{\"title\":\"二\",\"speakerNotes\":\"n\"}]}";

        assert_eq!(estimate_completed_pages(content), 2);
        assert_eq!(estimate_completed_pages(""), 0);
    }

    #[test]
    fn counts_the_pages_that_are_already_designed() {
        let content = "{\"slides\":[{\"layout\":\"cover\",\"visualNarrative\":\"statement\"},{\"layout\":\"split\",\"visualNarrative\":\"comparison\"}]}";

        assert_eq!(estimate_completed_designs(content), 2);
        // 半页写出来时不能算整页完成。
        assert_eq!(
            estimate_completed_designs("{\"slides\":[{\"layout\":\"cover\",\"visualNar"),
            0
        );
        assert_eq!(estimate_completed_designs(""), 0);
    }
}

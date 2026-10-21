import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Check, LayoutDashboard, Palette, Settings, Sparkles } from "lucide-react";
import { ContentReview } from "./features/ai/ContentReview";
import { draftMetrics, missingTitleIndexes, withSlideIds, type AiDraftSaveState } from "./features/ai/content-review";
import { aiDraftSchema } from "./services/ai-service";
import "./styles.css";

const plan = { purpose: "传达本页已审核内容", conclusion: "以本页标题和正文为准", visualIntent: "structured-text" as const, density: "medium" as const };

const draft = withSlideIds(aiDraftSchema.parse({
  title: "岳阳楼记课件",
  presentationBrief: {
    objective: "完成课堂讲解",
    audience: "初中学生",
    scenario: "语文课堂",
    expectedAction: "理解文章主旨",
    coreConclusion: "先天下之忧而忧",
    narrativeStrategy: "general",
    assumptions: [],
  },
  slides: [
    { title: "《岳阳楼记》概述", body: "1. 北宋文学家范仲淹的名篇\n2. 作于庆历六年(1046年)\n3. 通过描写岳阳楼景色抒发情怀\n4. 是古代散文名篇", speakerNotes: "复习上节课内容，引出本课主题。", plan, blocks: [{ type: "bullet-list", items: ["北宋文学家范仲淹的名篇", "作于庆历六年(1046年)", "通过描写岳阳楼景色抒发情怀", "是古代散文名篇"] }] },
    { title: "作者简介——范仲淹", body: "1. 字希文，北宋著名政治家、文学家\n2. 祖籍邠州，生于徐州\n3. 官至参知政事，推行庆历新政\n4. 代表作：《渔家傲》《岳阳楼记》等\n5. “先天下之忧而忧，后天下之乐而乐”", speakerNotes: "重点介绍范仲淹的政治理想和文学成就，特别强调其忧国忧民的情怀，为理解文章主旨做铺垫。", plan, blocks: [{ type: "bullet-list", items: ["字希文，北宋著名政治家、文学家", "祖籍邠州，生于徐州", "官至参知政事，推行庆历新政", "代表作：《渔家傲》《岳阳楼记》等", "“先天下之忧而忧，后天下之乐而乐”"] }] },
    { title: "写作背景", body: "1. 滕子京因主张改革被贬邓州\n2. 滕子京重修岳阳楼\n3. 请范仲淹作记\n4. 范仲淹借景抒情，表达政治抱负", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["滕子京因主张改革被贬邓州", "滕子京重修岳阳楼", "请范仲淹作记", "范仲淹借景抒情，表达政治抱负"] }] },
    { title: "原文赏析——第一段", body: "1. 交代写作缘由(庆历四年春)\n2. 滕子京谪守巴陵郡\n3. 越明年，政通人和，百废具兴\n4. 增其旧制，刻唐贤今人诗赋于其上", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["交代写作缘由(庆历四年春)", "滕子京谪守巴陵郡", "越明年，政通人和，百废具兴", "增其旧制，刻唐贤今人诗赋于其上"] }] },
    { title: "原文赏析——第二段", body: "1. 总写洞庭湖全景\n2. 衔远山，吞长江，浩浩汤汤\n3. 描写气象万千的景色\n4. 过渡到登楼览物之情\n5. 引出下文", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["总写洞庭湖全景", "衔远山，吞长江，浩浩汤汤", "描写气象万千的景色", "过渡到登楼览物之情", "引出下文"] }] },
    { title: "原文赏析——第三段", body: "1. 详写阴冷之景与悲之情\n2. 虎啸猿啼\n3. 商旅不行，樯倾楫摧\n4. 登斯楼也，则有去国怀乡之悲", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["详写阴冷之景与悲之情", "虎啸猿啼", "商旅不行，樯倾楫摧", "登斯楼也，则有去国怀乡之悲"] }] },
    { title: "原文赏析——第四段", body: "1. 详写晴朗之景与喜之情\n2. 沙鸥翔集，锦鳞游泳\n3. 岸芷汀兰，郁郁青青\n4. 登斯楼也，则有心旷神怡之喜", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["详写晴朗之景与喜之情", "沙鸥翔集，锦鳞游泳", "岸芷汀兰，郁郁青青", "登斯楼也，则有心旷神怡之喜"] }] },
    { title: "核心段落——第五段", body: "1. 由景及情，深入议论\n2. “不以物喜，不以己悲”\n3. 古仁人之心：忧国忧民\n4. “先天下之忧而忧，后天下之乐而乐”", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["由景及情，深入议论", "“不以物喜，不以己悲”", "古仁人之心：忧国忧民", "“先天下之忧而忧，后天下之乐而乐”"] }] },
    { title: "", body: "1. 本文的写作特色\n2. 叙事、写景、抒情、议论相结合\n3. 骈散结合，语言优美", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["本文的写作特色", "叙事、写景、抒情、议论相结合", "骈散结合，语言优美"] }] },
    { title: "课堂总结", body: "1. 掌握重点文言词句\n2. 理解作者的政治抱负\n3. 体会忧国忧民的情怀", speakerNotes: "布置课后作业。", plan, blocks: [{ type: "bullet-list", items: ["掌握重点文言词句", "理解作者的政治抱负", "体会忧国忧民的情怀"] }] },
  ],
}));

function Preview() {
  const [current, setCurrent] = useState(draft);
  const [activeIndex, setActiveIndex] = useState(1);
  const [saveState, setSaveState] = useState<AiDraftSaveState>("saved");
  const metrics = draftMetrics(current);
  const missing = missingTitleIndexes(current);
  return (
    <div>
      <nav className="nav-rail" style={{ position: "fixed", inset: "0 auto 0 0", width: 64 }}>
        <button><LayoutDashboard /><span>编辑</span></button>
        <button className="active"><Sparkles /><span>AI</span></button>
        <button><Palette /><span>模板</span></button>
        <div className="nav-spacer" />
        <button><Settings /><span>设置</span></button>
      </nav>
      <div style={{ position: "fixed", inset: "0 0 28px 64px" }}>
        <main className="feature-workspace" style={{ height: "100%" }}>
          <header className="feature-header">
            <div><Sparkles /><div><h1>AI 内容工作台</h1><p>生成并审核内容，确认后再套用 PPT 模板</p></div></div>
            <div className="feature-header-actions">
              <div className="workflow-steps" aria-label="制作流程">
                <span className="done"><Check /> 生成草稿</span><i />
                <span className="active" aria-current="step">2 编辑文字</span><i />
                <span>3 上传模板</span>
              </div>
              <div className="draft-header-actions">
                {missing.length > 0 && <span className="draft-blocked-hint">{missing.length} 页缺少标题</span>}
                <button className="primary-action" disabled={missing.length > 0}>确认内容，选择 PPT 模板<ArrowRight /></button>
              </div>
            </div>
          </header>
          <div className="feature-scroll draft-mode">
            <ContentReview
              draft={current}
              originalDraft={draft}
              activeIndex={activeIndex}
              saveState={saveState}
              onActiveIndexChange={setActiveIndex}
              onDraftTitleChange={(title) => setCurrent((value) => ({ ...value, title }))}
              onSlideFieldChange={(index, field, fieldValue) => {
                setSaveState("saving");
                setCurrent((draftValue) => ({
                  ...draftValue,
                  slides: draftValue.slides.map((slide, slideIndex) => {
                    if (slideIndex !== index) return slide;
                    if (field === "title") return { ...slide, title: fieldValue };
                    if (field === "body") return { ...slide, body: fieldValue };
                    return { ...slide, speakerNotes: fieldValue };
                  }),
                }));
                window.setTimeout(() => setSaveState("saved"), 500);
              }}
              onRestoreSlide={() => undefined}
              onNewDraft={() => undefined}
            />
          </div>
        </main>
      </div>
      <footer className="statusbar" style={{ position: "fixed", inset: "auto 0 0 64px", height: 28 }}>
        <span>草稿第 {activeIndex + 1} / {current.slides.length} 页</span>
        <span>{metrics.characters} 字</span>
        <span>{metrics.points} 条要点</span>
        <span className={`saved-dot ${saveState === "saving" ? "dirty" : ""}`}>● {saveState === "saving" ? "保存中…" : "已自动保存"}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("preview-root")!).render(<Preview />);

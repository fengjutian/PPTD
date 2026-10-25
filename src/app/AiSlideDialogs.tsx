import { SlideRewriteDialog } from "../features/ai/SlideRewriteDialog";

import { SlideTitleDialog } from "../features/ai/SlideTitleDialog";
import { SpeakerNotesDialog } from "../features/ai/SpeakerNotesDialog";
import { SplitSlideDialog } from "../features/ai/SplitSlideDialog";
import { DeckReviewDialog } from "../features/ai/DeckReviewDialog";

import type { AppRuntime } from "./app-runtime";

export function AiSlideDialogs({ app }: { app: AppRuntime }) {
  const {
    slideRewrite,
    rewriteSlide,
    runSlideRewrite,
    applySlideRewrite,
    closeSlideRewrite,
    slideAssist,
    assistSlide,
    applyTitleAssist,
    runTitleAssist,
    closeSlideAssist,
    applyNotesAssist,
    runNotesAssist,
    applySplitAssist,
    runSplitAssist,
    deckReview,
    jumpToDeckReviewIssue,
    rewriteFromDeckReviewIssue,
    runDeckReview,
    closeDeckReview,
  } = app;

  return (
    <>
      {slideRewrite && rewriteSlide && (
        <SlideRewriteDialog
          slideIndex={slideRewrite.index}
          title={rewriteSlide.title}
          body={rewriteSlide.body}
          speakerNotes={rewriteSlide.speakerNotes}
          status={slideRewrite.status}
          proposal={slideRewrite.proposal}
          error={slideRewrite.error}
          defaultInstruction={slideRewrite.instruction}
          onGenerate={(instruction) => void runSlideRewrite(instruction)}
          onApply={applySlideRewrite}
          onClose={closeSlideRewrite}
        />
      )}
      {slideAssist?.kind === "title" && assistSlide && (
        <SlideTitleDialog
          slideIndex={slideAssist.index}
          currentTitle={assistSlide.title}
          status={slideAssist.status}
          candidates={slideAssist.candidates}
          error={slideAssist.error}
          onPick={applyTitleAssist}
          onRetry={() => void runTitleAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}
      {slideAssist?.kind === "notes" && assistSlide && (
        <SpeakerNotesDialog
          slideIndex={slideAssist.index}
          title={assistSlide.title}
          currentNotes={assistSlide.speakerNotes}
          status={slideAssist.status}
          proposal={slideAssist.proposal}
          error={slideAssist.error}
          onApply={applyNotesAssist}
          onRetry={() => void runNotesAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}
      {slideAssist?.kind === "split" && assistSlide && (
        <SplitSlideDialog
          slideIndex={slideAssist.index}
          title={assistSlide.title}
          status={slideAssist.status}
          pages={slideAssist.pages}
          error={slideAssist.error}
          onApply={applySplitAssist}
          onRetry={() => void runSplitAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}
      {deckReview && (
        <DeckReviewDialog
          status={deckReview.status}
          issues={deckReview.issues}
          error={deckReview.error}
          onJump={jumpToDeckReviewIssue}
          onRewriteIssue={rewriteFromDeckReviewIssue}
          onRetry={() => void runDeckReview()}
          onClose={closeDeckReview}
        />
      )}
    </>
  );
}

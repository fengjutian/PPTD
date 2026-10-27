import type { PresentationDocument, SlideElement } from "../document-model";
import { captureContentVersion, MAX_DESIGN_DIRECTIONS } from "../document-model";
import type { LayoutDefinition, LayoutSlotRole } from "../layout/tree";

import { CONCEPT_PRESET_IDS } from "../design/deck-concept";

import type { DocumentCommand } from "./commands";
import { directionContentFingerprint } from "./ai-draft-helpers";
import { buildDesignedSlide, createDesignContext } from "./design-page-builder";
import type { DesignCompileOutcome, DesignCompileReport } from "../layout/design-compiler";

export interface SlideDesignCompileReport {
  slideIndex: number;
  report: DesignCompileReport;
}

export interface DesignDraftCompileReport {
  outcome: DesignCompileOutcome;
  plannedSlides: number;
  acceptedSlides: number;
  adjustedSlides: number;
  rejectedSlides: number;
  slides: readonly SlideDesignCompileReport[];
}

function summarizeCompileReports(slides: readonly SlideDesignCompileReport[]): DesignDraftCompileReport {
  const adjustedSlides = slides.filter((item) => item.report.outcome === "accepted-with-adjustments").length;
  const rejectedSlides = slides.filter((item) => item.report.outcome === "rejected").length;
  const acceptedSlides = slides.length - adjustedSlides - rejectedSlides;
  return {
    outcome: rejectedSlides > 0 ? "rejected" : adjustedSlides > 0 ? "accepted-with-adjustments" : "accepted",
    plannedSlides: slides.length,
    acceptedSlides,
    adjustedSlides,
    rejectedSlides,
    slides: slides.map((item) => ({ slideIndex: item.slideIndex, report: item.report })),
  };
}

function layoutRole(element: SlideElement): LayoutSlotRole {
  if (element.type === "image") return "image";
  if (element.type === "chart") return "chart";
  if (element.type === "table") return "table";
  if (element.type === "text") return element.contentRef === "title" ? "title" : "body";
  return "decoration";
}

/** Captures each generated page as an editable LayoutTree in the same transaction. */
function attachGeneratedLayoutTrees(document: PresentationDocument): void {
  const definitions: LayoutDefinition[] = document.slides.map((slide, slideIndex) => {
    const managed = slide.elements.filter((element) => element.origin === "generated" && element.hidden !== true);
    const tree: LayoutDefinition["tree"] = {
      coordinateSpace: "normalized-1000",
      registryVersion: 1,
      root: {
        id: slide.id,
        type: "canvas",
        width: { mode: "fill" },
        height: { mode: "fill" },
        layoutState: "managed",
        children: managed.map((element) => ({
          id: element.id,
          type: "slot",
          role: layoutRole(element),
          contentRef: element.type === "text" ? element.contentRef : undefined,
          width: { mode: "fill" },
          height: {
            mode: "fraction",
            weight: Math.max(1, Math.round((element.frame.height / document.pageSize.height) * 1000)),
          },
          // Geometry remains the compiler's source of truth. Detached slots
          // make the generated arrangement editable without an eager reflow.
          layoutState: "detached",
        })),
      },
    };
    const definition: LayoutDefinition = {
      id: slide.id,
      name: `AI 页面 ${slideIndex + 1}`,
      layoutSchemaVersion: 1,
      tree,
    };
    slide.layoutBinding = {
      definitionId: definition.id,
      slotBindings: Object.fromEntries(managed.map((element) => [element.id, element.id])),
    };
    return definition;
  });
  document.layoutDefinitions = definitions;
}

/**
 * Applies an AI-designed draft: every page is replaced by the composition the
 * design stage planned. The generated objects are marked as such so a later
 * design-only relayout can replace them without touching user additions.
 */
export function applyAiDesignedDraft(
  document: PresentationDocument,
  command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>,
): DesignDraftCompileReport {
  if (
    !command.title.trim() ||
    command.slides.length < 1 ||
    command.slides.length > 20 ||
    command.designs.length !== command.slides.length
  )
    throw new Error("AI_DESIGN_INVALID");
  if (
    command.visualAssets?.some(
      (asset) =>
        !Number.isFinite(asset.naturalWidth) ||
        !Number.isFinite(asset.naturalHeight) ||
        asset.naturalWidth <= 0 ||
        asset.naturalHeight <= 0 ||
        (asset.focalPoint !== undefined &&
          (!Number.isFinite(asset.focalPoint.x) ||
            !Number.isFinite(asset.focalPoint.y) ||
            asset.focalPoint.x < 0 ||
            asset.focalPoint.x > 1 ||
            asset.focalPoint.y < 0 ||
            asset.focalPoint.y > 1)),
    )
  )
    throw new Error("AI_VISUAL_ASSET_INVALID");
  if (command.pageSize) document.pageSize = command.pageSize;

  const context = createDesignContext(document, command);
  document.slides = command.slides.map((content, index) => buildDesignedSlide(context, content, index));
  attachGeneratedLayoutTrees(document);
  // The direction decision is design state: it is recorded with the design and
  // never touches the content hash. A preset the renderer cannot draw, or a
  // decision taken against different content, is refused instead of stored.
  if (command.designDirection) {
    const direction = command.designDirection;
    if (
      direction.proposals.some((proposal) => !CONCEPT_PRESET_IDS.includes(proposal.preset)) ||
      !direction.proposals.some((proposal) => proposal.id === direction.selectedProposalId)
    ) {
      throw new Error("DESIGN_DIRECTION_INVALID");
    }
    if (direction.contentFingerprint !== directionContentFingerprint(command.slides)) {
      throw new Error("DESIGN_DIRECTION_STALE");
    }
    document.designDirections = [...(document.designDirections ?? []), direction].slice(-MAX_DESIGN_DIRECTIONS);
  }
  // Applying a reviewed draft is a confirmation act: keep the confirmed copy
  // so a later edit can be compared with what the user actually approved.
  captureContentVersion(document);
  return summarizeCompileReports(context.compileReports);
}

/**
 * Compiles a command against an isolated snapshot and returns only its design
 * diagnostics. The inspected document is never exposed, so reporting cannot
 * mutate the project, its revisions or the undo stack.
 */
export function inspectAiDesignedDraftCompilation(
  document: PresentationDocument,
  command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>,
): DesignDraftCompileReport {
  return applyAiDesignedDraft(structuredClone(document), structuredClone(command));
}

export interface BuiltDesignPage {
  /** A one-page snapshot produced by the real design command path. */
  document: PresentationDocument;
  report: DesignDraftCompileReport;
}

/**
 * Builds one page on an isolated clone and returns both the page and its
 * compile report.
 *
 * The source document is never touched. This is the function the candidate
 * loop uses so a candidate page and its diagnostics come from the same build,
 * instead of compiling twice and risking two different answers.
 */
export function buildDesignedPage(
  document: PresentationDocument,
  command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>,
): BuiltDesignPage {
  const clone = structuredClone(document);
  const report = applyAiDesignedDraft(clone, command);
  return { document: clone, report };
}

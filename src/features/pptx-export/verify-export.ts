/**
 * Export read-back parity.
 *
 * The exporter maps the document to PPTX; this module reads the written package
 * back and compares it with the document. It deliberately does not reuse the
 * exporter's mapping code: a checker that shares the exporter's blind spots
 * proves nothing. Text is compared against the slide XML, not against the
 * exporter's intermediate objects.
 *
 * The result is advisory. A mismatch is reported, never repaired, and never
 * deletes the file the user just exported.
 */

import { strFromU8, unzipSync, zipSync } from "fflate";
import type { PresentationDocument, Slide } from "../../core/document-model";

export type ExportParityIssueKind = "missing-slide" | "missing-text" | "picture-count" | "table-count" | "chart-count";

export interface ExportParityIssue {
  slideIndex: number;
  kind: ExportParityIssueKind;
  expected: number | string;
  actual: number | string;
  detail?: string;
}

export interface ExportParityReport {
  passed: boolean;
  issues: ExportParityIssue[];
  checked: {
    slides: number;
    textFragments: number;
    pictures: number;
    tables: number;
    charts: number;
  };
  /** What this check deliberately does not cover. */
  skipped: string[];
  /** Set when the package could not be read at all. */
  error?: string;
}

const SLIDE_PART = /^ppt\/slides\/slide(\d+)\.xml$/;

export function verifyExportedPptx(bytes: Uint8Array, document: PresentationDocument): ExportParityReport {
  const checked = { slides: 0, textFragments: 0, pictures: 0, tables: 0, charts: 0 };
  const issues: ExportParityIssue[] = [];
  const skipped = ["chart-labels:chart-part", "speaker-notes:notes-part"];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    return {
      passed: false,
      issues,
      checked,
      skipped,
      error: `EXPORT_PARITY_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parts = new Map<number, string>();
  for (const [path, content] of Object.entries(entries)) {
    const match = SLIDE_PART.exec(path);
    if (match) parts.set(Number.parseInt(match[1]!, 10), strFromU8(content));
  }

  document.slides.forEach((slide, slideIndex) => {
    const xml = parts.get(slideIndex + 1);
    if (!xml) {
      issues.push({ slideIndex, kind: "missing-slide", expected: slideIndex + 1, actual: 0 });
      return;
    }
    checked.slides += 1;

    const actualText = normalize(extractText(xml));
    const expectedTexts = expectedTextFragments(slide);
    for (const fragment of expectedTexts) {
      const normalized = normalize(fragment);
      if (!normalized) continue;
      checked.textFragments += 1;
      if (!actualText.includes(normalized)) {
        issues.push({ slideIndex, kind: "missing-text", expected: normalized, actual: "", detail: fragment });
      }
    }

    const expectedPictures = slide.elements.filter(
      (element) => element.type === "image" && element.placement !== "layout-background",
    ).length;
    const expectedTables = slide.elements.filter((element) => element.type === "table").length;
    const expectedCharts = slide.elements.filter((element) => element.type === "chart").length;
    const actualPictures = count(xml, /<p:pic(?:\s|>)/g);
    const actualTables = count(xml, /<a:tbl(?:\s|>)/g);
    const actualCharts = count(xml, /<c:chart(?:\s|>)/g);
    checked.pictures += expectedPictures;
    checked.tables += expectedTables;
    checked.charts += expectedCharts;

    if (actualPictures !== expectedPictures) {
      issues.push({ slideIndex, kind: "picture-count", expected: expectedPictures, actual: actualPictures });
    }
    if (actualTables !== expectedTables) {
      issues.push({ slideIndex, kind: "table-count", expected: expectedTables, actual: actualTables });
    }
    if (actualCharts !== expectedCharts) {
      issues.push({ slideIndex, kind: "chart-count", expected: expectedCharts, actual: actualCharts });
    }
  });

  return { passed: issues.length === 0, issues, checked, skipped };
}

/** Text a reader sees on the page: text boxes plus table cells. */
function expectedTextFragments(slide: Slide): string[] {
  const fragments = slide.elements
    .filter((element) => element.type === "text")
    .map((element) => (element.type === "text" ? element.text : ""));
  for (const block of slide.content.blocks ?? []) {
    if (block.type !== "table-data") continue;
    fragments.push(...block.header, ...block.rows.flat());
  }
  return fragments;
}

function extractText(xml: string): string {
  const matches = xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g);
  let text = "";
  for (const match of matches) text += unescapeXml(match[1] ?? "");
  return text;
}

function count(xml: string, pattern: RegExp): number {
  return (xml.match(pattern) ?? []).length;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Whitespace and zero-width characters are not content. The exporter may split a
 * sentence into runs; PowerPoint does not promise the same run boundaries.
 */
function normalize(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rebuilds a package with one slide part replaced. Exposed for tests: the point
 * of a read-back check is that it notices a damaged package.
 */
export function replaceSlidePart(bytes: Uint8Array, slideNumber: number, xml: string): Uint8Array {
  const entries = unzipSync(bytes);
  entries[`ppt/slides/slide${slideNumber}.xml`] = new TextEncoder().encode(xml);
  return zipSync(entries, { level: 6 });
}

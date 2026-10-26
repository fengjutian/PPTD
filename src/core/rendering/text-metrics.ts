/**
 * The port through which the running application tells the document core how
 * wide a piece of text really is.
 *
 * The core cannot measure a font itself: it must stay free of the browser and
 * of the desktop runtime. The application injects a measurer built on the real
 * font, and the core falls back to a rough estimate when no measurer is
 * registered, so the model stays testable and headless tools keep working.
 */
export interface TextMeasurer {
  /**
   * The width of the text in em, relative to the font size.
   *
   * `bold` asks for the bold face when the font has one: a bold run is wider
   * than its regular counterpart, and a title set in 700 weight was measured
   * with the regular advance until this argument existed.
   */
  widthEm(text: string, fontFamily: string, bold?: boolean): number;
}

let activeMeasurer: TextMeasurer | undefined;

/** Registers the measurer of the running application. Passing undefined restores the estimate. */
export function setTextMeasurer(measurer: TextMeasurer | undefined): void {
  activeMeasurer = measurer;
}

/** The measurer of the running application, if there is one. */
export function getTextMeasurer(): TextMeasurer | undefined {
  return activeMeasurer;
}

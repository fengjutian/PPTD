import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Turns an exported deck into pictures.
 *
 * The visual regression check needs to see what the file really looks like in
 * an application, not what the editor believes it looks like. Two renderers are
 * supported and each of them keeps its own reference, because a picture drawn
 * by PowerPoint and a picture drawn by LibreOffice are not the same picture.
 */

export interface RasterizedSlide {
  /** The page number, starting at one. */
  index: number;
  png: Uint8Array;
}

export interface PptxRasterizer {
  /** The name of the renderer. It names the folder of the reference pictures. */
  name: string;
  /** How many pages the renderer can produce. */
  readonly coverage: "all" | "first-only";
  rasterize(pptxPath: string, outputDirectory: string): Promise<RasterizedSlide[]>;
}

const SCRIPT = fileURLToPath(new URL("./export-slides.ps1", import.meta.url));
const LIBREOFFICE_PATHS = [
  "C:/Program Files/LibreOffice/program/soffice.com",
  "C:/Program Files (x86)/LibreOffice/program/soffice.com",
];

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} failed: ${error.message}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function readRenderedSlides(directory: string): RasterizedSlide[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^slide-\d+\.png$/i.test(name))
    .sort((left, right) => Number(left.match(/\d+/)![0]) - Number(right.match(/\d+/)![0]))
    .map((name) => ({
      index: Number(name.match(/\d+/)![0]),
      png: new Uint8Array(readFileSync(join(directory, name))),
    }));
}

/** Renders with PowerPoint, the application the deck is meant for. */
export const powerPointRasterizer: PptxRasterizer = {
  name: "powerpoint",
  coverage: "all",
  async rasterize(pptxPath, outputDirectory) {
    await run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT,
      "-Pptx",
      pptxPath,
      "-OutDir",
      outputDirectory,
    ]);
    return readRenderedSlides(outputDirectory);
  },
};

/** Renders with LibreOffice, which is available on more machines than PowerPoint. */
export const libreOfficeRasterizer: PptxRasterizer = {
  name: "libreoffice",
  coverage: "first-only",
  async rasterize(pptxPath, outputDirectory) {
    const executable = LIBREOFFICE_PATHS.find((candidate) => existsSync(candidate));
    if (!executable) throw new Error("LIBREOFFICE_NOT_FOUND");
    await run(executable, ["--headless", "--convert-to", "png", "--outdir", outputDirectory, pptxPath]);
    const slides = readRenderedSlides(outputDirectory);
    if (slides.length === 0) {
      // LibreOffice names the picture after the file, so it is renamed to the
      // name the rest of the check expects.
      const produced = readdirSync(outputDirectory).filter((name) => name.toLowerCase().endsWith(".png"));
      const first = produced[0];
      if (!first) throw new Error("LIBREOFFICE_RENDER_EMPTY");
      const png = new Uint8Array(readFileSync(join(outputDirectory, first)));
      return [{ index: 1, png }];
    }
    return slides;
  },
};

/**
 * Picks the renderer that is available on this machine.
 *
 * PowerPoint comes first: it is the application the deck is exported for, so
 * its rendering is the one worth watching. LibreOffice is the fallback.
 */
export async function detectRasterizer(): Promise<PptxRasterizer | undefined> {
  if (process.platform === "win32" && existsSync(SCRIPT)) {
    try {
      await run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$p = New-Object -ComObject PowerPoint.Application; $p.Quit()",
      ]);
      return powerPointRasterizer;
    } catch {
      // PowerPoint is not installed or cannot be automated; fall through.
    }
  }
  if (LIBREOFFICE_PATHS.some((candidate) => existsSync(candidate))) return libreOfficeRasterizer;
  return undefined;
}

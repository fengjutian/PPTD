import { unzlibSync, zlibSync } from "fflate";

/**
 * A picture in plain memory: RGBA, four bytes per pixel, row major.
 *
 * The visual regression check compares two of these, so the format is the one
 * the browser already speaks and no colour space conversion is needed.
 */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel for every PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

/**
 * Undoes the per-scanline filters of a PNG image.
 *
 * The filters are the reason a PNG cannot be read by simply inflating it: each
 * row encodes a difference to the row above it.
 */
function unfilter(raw: Uint8Array, height: number, bytesPerRow: number, bytesPerPixel: number): Uint8Array {
  const out = new Uint8Array(bytesPerRow * height);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position]!;
    position += 1;
    const rowStart = y * bytesPerRow;
    const previousStart = rowStart - bytesPerRow;
    for (let x = 0; x < bytesPerRow; x += 1) {
      const value = raw[position + x]!;
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel]! : 0;
      const up = y > 0 ? out[previousStart + x]! : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[previousStart + x - bytesPerPixel]! : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error("PNG_FILTER_INVALID");
      }
      out[rowStart + x] = result & 0xff;
    }
    position += bytesPerRow;
  }
  return out;
}

/**
 * Reads one sample of a scanline.
 *
 * Samples below eight bits share a byte, and a sixteen bit sample keeps its
 * high byte only: the low byte carries precision the comparison does not need.
 */
function sampleValue(row: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 8) return row[index]!;
  if (bitDepth === 16) return row[index * 2]!;
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(index / perByte)]!;
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

function readHeader(data: Uint8Array): Header {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = data[8]!;
  const colorType = data[9]!;
  const interlace = data[12]!;
  if (interlace !== 0) throw new Error("PNG_INTERLACED_UNSUPPORTED");
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new Error("PNG_COLOR_TYPE_UNSUPPORTED");
  const allowed: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!allowed[colorType]!.includes(bitDepth)) throw new Error("PNG_BIT_DEPTH_UNSUPPORTED");
  if (width <= 0 || height <= 0) throw new Error("PNG_SIZE_INVALID");
  return { width, height, bitDepth, colorType };
}

/**
 * Decodes a PNG file into plain RGBA memory.
 *
 * PowerPoint writes palette images, so the palette path is the one that
 * matters in practice; truecolour, greyscale and the alpha variants are
 * supported as well. Interlaced images are rejected instead of being read
 * wrongly.
 */
export function decodePng(bytes: Uint8Array): PixelImage {
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) throw new Error("PNG_SIGNATURE_INVALID");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const dataChunks: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error("PNG_TRUNCATED");
    if (type === "IHDR") {
      header = readHeader(bytes.subarray(start, end));
    } else if (type === "PLTE") {
      palette = bytes.slice(start, end);
    } else if (type === "tRNS") {
      transparency = bytes.slice(start, end);
    } else if (type === "IDAT") {
      dataChunks.push(bytes.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }

  if (!header) throw new Error("PNG_HEADER_MISSING");
  if (dataChunks.length === 0) throw new Error("PNG_DATA_MISSING");
  if (header.colorType === 3 && !palette) throw new Error("PNG_PALETTE_MISSING");

  const compressed = new Uint8Array(dataChunks.reduce((total, chunk) => total + chunk.length, 0));
  let cursor = 0;
  for (const chunk of dataChunks) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }

  const channels = CHANNELS[header.colorType]!;
  const bitsPerPixel = header.bitDepth * channels;
  const bytesPerRow = Math.ceil((bitsPerPixel * header.width) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const raw = unfilter(unzlibSync(compressed), header.height, bytesPerRow, bytesPerPixel);

  const { width, height, bitDepth, colorType } = header;
  const data = new Uint8ClampedArray(width * height * 4);
  const maxSample = (1 << Math.min(bitDepth, 8)) - 1;

  for (let y = 0; y < height; y += 1) {
    const row = raw.subarray(y * bytesPerRow, y * bytesPerRow + bytesPerRow);
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (colorType === 3) {
        const index = sampleValue(row, x, bitDepth);
        const paletteOffset = index * 3;
        data[target] = palette![paletteOffset] ?? 0;
        data[target + 1] = palette![paletteOffset + 1] ?? 0;
        data[target + 2] = palette![paletteOffset + 2] ?? 0;
        data[target + 3] = transparency?.[index] ?? 255;
        continue;
      }
      if (colorType === 0 || colorType === 4) {
        const gray =
          bitDepth < 8 ? Math.round((sampleValue(row, x, bitDepth) * 255) / maxSample) : sampleValue(row, x, bitDepth);
        data[target] = gray;
        data[target + 1] = gray;
        data[target + 2] = gray;
        if (colorType === 4) {
          data[target + 3] = sampleValue(row, x * 2 + 1, bitDepth);
        } else if (transparency && transparency.length >= 2) {
          const transparent = (transparency[0]! << 8) | transparency[1]!;
          data[target + 3] = gray === transparent ? 0 : 255;
        } else {
          data[target + 3] = 255;
        }
        continue;
      }
      const red = sampleValue(row, x * channels, bitDepth);
      const green = sampleValue(row, x * channels + 1, bitDepth);
      const blue = sampleValue(row, x * channels + 2, bitDepth);
      data[target] = red;
      data[target + 1] = green;
      data[target + 2] = blue;
      if (colorType === 6) {
        data[target + 3] = sampleValue(row, x * channels + 3, bitDepth);
      } else if (transparency && transparency.length >= 6) {
        const transparent = [
          (transparency[0]! << 8) | transparency[1]!,
          (transparency[2]! << 8) | transparency[3]!,
          (transparency[4]! << 8) | transparency[5]!,
        ];
        const matches = transparent[0] === red && transparent[1] === green && transparent[2] === blue;
        data[target + 3] = matches ? 0 : 255;
      } else {
        data[target + 3] = 255;
      }
    }
  }

  return { width, height, data };
}

/** Bytes of a picture: a plain array or the clamped one the browser uses. */
type Bytes = Uint8Array | Uint8ClampedArray;

function filterRow(type: number, row: Bytes, previous: Bytes, bytesPerRow: number, bytesPerPixel: number): Uint8Array {
  const out = new Uint8Array(bytesPerRow);
  for (let x = 0; x < bytesPerRow; x += 1) {
    const value = row[x]!;
    const left = x >= bytesPerPixel ? row[x - bytesPerPixel]! : 0;
    const up = previous[x] ?? 0;
    const upLeft = x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;
    switch (type) {
      case 1:
        out[x] = (value - left) & 0xff;
        break;
      case 2:
        out[x] = (value - up) & 0xff;
        break;
      case 3:
        out[x] = (value - ((left + up) >> 1)) & 0xff;
        break;
      case 4:
        out[x] = (value - paeth(left, up, upLeft)) & 0xff;
        break;
      default:
        out[x] = value;
        break;
    }
  }
  return out;
}

function filterCost(row: Uint8Array): number {
  let cost = 0;
  for (const byte of row) cost += byte < 128 ? byte : 256 - byte;
  return cost;
}

/**
 * Encodes a picture as a PNG file.
 *
 * Every scanline is filtered with the filter that costs the least, which is
 * what keeps a reference image small enough to keep in the repository.
 */
export function encodePng(image: PixelImage): Uint8Array {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) throw new Error("PNG_SIZE_INVALID");
  if (data.length < width * height * 4) throw new Error("PNG_DATA_TRUNCATED");

  const bytesPerRow = width * 4;
  const raw = new Uint8Array((bytesPerRow + 1) * height);
  let previous: Bytes = new Uint8Array(bytesPerRow);
  for (let y = 0; y < height; y += 1) {
    const row: Bytes = data.subarray(y * bytesPerRow, y * bytesPerRow + bytesPerRow);
    let bestType = 0;
    let bestRow = filterRow(0, row, previous, bytesPerRow, 4);
    let bestCost = filterCost(bestRow);
    for (const type of [1, 2, 3, 4]) {
      const candidate = filterRow(type, row, previous, bytesPerRow, 4);
      const cost = filterCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        bestRow = candidate;
      }
    }
    raw[y * (bytesPerRow + 1)] = bestType;
    raw.set(bestRow, y * (bytesPerRow + 1) + 1);
    previous = row;
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const parts = [
    new Uint8Array(SIGNATURE),
    buildChunk("IHDR", header),
    buildChunk("IDAT", zlibSync(raw, { level: 9 })),
    buildChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

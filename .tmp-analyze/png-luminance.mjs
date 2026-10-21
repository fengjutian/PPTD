// Minimal PNG decoder + luminance probe, mirroring the browser probe in
// src/services/template-background.ts so the end-to-end check measures the same
// thing the desktop app measures.
import { inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

export function decodePng(buffer) {
  let offset = 8;
  let width = 0; let height = 0; let bitDepth = 8; let colorType = 6;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported png bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (!channels) throw new Error(`unsupported png color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position]; position += 1;
    const line = raw.subarray(position, position + stride); position += stride;
    const current = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? current[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
      const value = line[x];
      if (filter === 0) current[x] = value;
      else if (filter === 1) current[x] = (value + a) & 255;
      else if (filter === 2) current[x] = (value + b) & 255;
      else if (filter === 3) current[x] = (value + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        current[x] = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else throw new Error(`unsupported png filter ${filter}`);
    }
  }
  return { width, height, channels, data: out };
}

const channel = (value) => {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

export function measureLuminance(image, frame) {
  const { width, height, channels, data } = image;
  const x0 = Math.max(0, Math.floor(frame.x * width));
  const y0 = Math.max(0, Math.floor(frame.y * height));
  const x1 = Math.min(width, Math.ceil((frame.x + frame.width) * width));
  const y1 = Math.min(height, Math.ceil((frame.y + frame.height) * height));
  if (x1 <= x0 || y1 <= y0) return undefined;
  // Same nine points and the same quantile as the browser probe and the
  // rendered-pixel inspector.
  const luminances = [];
  for (const yFactor of [0.2, 0.5, 0.8]) {
    for (const xFactor of [0.15, 0.5, 0.85]) {
      const x = Math.min(x1 - 1, Math.max(x0, Math.floor(x0 + (x1 - x0) * xFactor)));
      const y = Math.min(y1 - 1, Math.max(y0, Math.floor(y0 + (y1 - y0) * yFactor)));
      const offset = (y * width + x) * channels;
      luminances.push(channel(data[offset]) * 0.2126 + channel(data[offset + 1]) * 0.7152 + channel(data[offset + 2]) * 0.0722);
    }
  }
  const sorted = luminances.sort((left, right) => left - right);
  const quantile = Math.floor(sorted.length * 0.25);
  return { darkest: Number(sorted[quantile].toFixed(4)), lightest: Number(sorted[sorted.length - 1 - quantile].toFixed(4)) };
}

if (process.argv[2]) {
  const layouts = JSON.parse(readFileSync(".tmp-analyze/real-layouts.json", "utf8"));
  const probes = {};
  for (const layout of layouts.layouts) {
    const image = decodePng(readFileSync(`.tmp-analyze/renders/layout${layout.index}.png`));
    const normalized = layout.regions.map((region) => ({
      role: region.role,
      frame: { x: region.x / layouts.slideWidthEmu, y: region.y / layouts.slideHeightEmu, width: region.width / layouts.slideWidthEmu, height: region.height / layouts.slideHeightEmu },
    }));
    const title = normalized.find((region) => region.role === "title");
    const body = [...normalized.filter((region) => region.role === "body")].sort((left, right) => right.frame.width * right.frame.height - left.frame.width * left.frame.height)[0];
    const probe = {};
    if (title) { const value = measureLuminance(image, title.frame); if (value !== undefined) probe.title = value; }
    if (body) { const value = measureLuminance(image, body.frame); if (value !== undefined) probe.body = value; }
    probes[String(layout.index)] = probe;
    console.log(`${layout.index}\t${layout.name}\t${JSON.stringify(probe)}`);
  }
  writeFileSync(".tmp-analyze/real-probes.json", JSON.stringify(probes, null, 2), "utf8");
}

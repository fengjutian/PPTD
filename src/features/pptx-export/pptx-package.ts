export interface PptxPackageValidation {
  valid: boolean;
  entryCount: number;
  slideCount: number;
  issues: string[];
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 65_535;

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Structural check for the ZIP container. It deliberately does not extract
 * entries; it verifies the central directory and the OOXML entry names that
 * PowerPoint needs in order to open the package.
 */
export function validatePptxPackage(bytes: Uint8Array): PptxPackageValidation {
  const issues: string[] = [];
  if (bytes.length < EOCD_MIN_SIZE) {
    return { valid: false, entryCount: 0, slideCount: 0, issues: ["ZIP 文件过短"] };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const searchStart = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  let eocdOffset = -1;
  for (let offset = bytes.length - EOCD_MIN_SIZE; offset >= searchStart; offset -= 1) {
    if (readUint32(view, offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    return { valid: false, entryCount: 0, slideCount: 0, issues: ["找不到 ZIP 中央目录结束记录"] };
  }

  const entryCount = readUint16(view, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
  if (centralDirectoryOffset >= bytes.length) {
    return { valid: false, entryCount, slideCount: 0, issues: ["ZIP 中央目录偏移无效"] };
  }

  const names: string[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readUint32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      issues.push("ZIP 中央目录条目损坏");
      break;
    }
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) {
      issues.push("ZIP 条目名称越界");
      break;
    }
    names.push(decodeName(bytes.subarray(nameStart, nameEnd)));
    offset = nameEnd + extraLength + commentLength;
  }

  const slideCount = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  for (const required of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]) {
    if (!names.includes(required)) issues.push(`缺少必要条目：${required}`);
  }
  if (slideCount === 0) issues.push("没有发现幻灯片 XML");
  if (entryCount !== names.length) issues.push("ZIP 条目数量与中央目录不一致");

  return { valid: issues.length === 0, entryCount, slideCount, issues };
}

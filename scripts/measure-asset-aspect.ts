import { planVisualAssetLayout } from "../src/core/commands/visual-asset";
import { coverCrop } from "../src/core/rendering/image-fit";
import { DEFAULT_CONTENT_REGION, CONTENT_REGION } from "../src/core/commands/layout-capacity";

const pageWidth = 12191695;
const pageHeight = 6858000;
const region = DEFAULT_CONTENT_REGION;
const contentTop = region.top + Math.min(CONTENT_REGION.contentTopOffset, (region.bottom - region.top) * 0.3);
const content = { x: region.left, y: contentTop, width: region.right - region.left, height: region.bottom - contentTop };

console.log("内容区（归一化）", content);
for (const role of ["hero", "side", "band"] as const) {
  const layout = planVisualAssetLayout(role, content);
  const targetPx = { width: layout.image.width * pageWidth, height: layout.image.height * pageHeight };
  const targetAspect = targetPx.width / targetPx.height;
  const requested = role === "band" ? { width: 1280, height: 720 } : { width: 1024, height: 1024 };
  const crop = coverCrop(requested, targetPx);
  const kept = crop ? 1 - crop.left - crop.right - crop.top - crop.bottom : 1;
  console.log(
    role,
    "框比例", targetAspect.toFixed(2),
    "请求比例", (requested.width / requested.height).toFixed(2),
    "保留画面", (kept * 100).toFixed(1) + "%",
    JSON.stringify(crop),
  );
}

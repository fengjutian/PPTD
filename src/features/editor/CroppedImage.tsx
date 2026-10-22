import { useEffect, useState, type CSSProperties } from "react";
import type { ImageElement } from "../../core/document-model";
import { cropGeometry } from "../../core/rendering/image-crop";
import {
  isAssetReference,
  isFailedImageReference,
  peekImageUrl,
  resolveImageUrl,
  subscribeImageFailures,
  subscribeImageProjectPath,
} from "../../services/image-url-service";

interface CroppedImageProps {
  element: ImageElement;
  className?: string;
  /** The thumbnail repeats the picture without describing it again. */
  alt?: string;
}

/**
 * Draws a picture with its crop applied. The visible region of the source is
 * stretched over the frame, the same way the exported picture fills its
 * shape, so the canvas and the PPTX show the same picture.
 *
 * An inline data URL renders directly; an asset reference is loaded lazily and
 * cached by the image service, so opening a project no longer decodes every
 * picture into base64 up front.
 *
 * A picture that cannot be shown is replaced by a plain block. The browser
 * draws its own broken image icon for an `<img>` it cannot load, and that icon
 * is the one thing the page must never show.
 *
 * 读不到的图片画成一块看得出来的"缺图"，而不是留一片空白：空白会被当成作者
 * 故意不放图，模板版式背景就是这么消失得无声无息。
 */
export function CroppedImage({ element, className, alt }: CroppedImageProps) {
  const geometry = cropGeometry(element.crop);
  const source = element.source.dataUrl;
  const [url, setUrl] = useState<string | undefined>(() => (isAssetReference(source) ? peekImageUrl(source) : source));
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    let active = true;
    const resolve = () => {
      if (!isAssetReference(source)) {
        setUrl(source);
        return;
      }
      // 已知读不到就不用再问一次后端，失败集合就是结论。
      if (isFailedImageReference(source)) {
        setUrl(undefined);
        setUnreadable(true);
        return;
      }
      void resolveImageUrl(source).then(
        (resolved) => {
          if (!active) return;
          setUnreadable(false);
          setUrl(resolved);
        },
        () => {
          if (!active) return;
          setUrl(undefined);
          setUnreadable(true);
        },
      );
    };
    resolve();
    // The project path can arrive after the document was drawn: the recovery
    // flow reads the snapshot and the path of its asset directory in two
    // calls, so a picture that was resolved too early has to be read again.
    // The same goes for the failure set: another picture of the document may
    // have been what cleared the missing file.
    const watchFailures = isAssetReference(source) ? subscribeImageFailures(resolve) : undefined;
    const unsubscribe = isAssetReference(source) ? subscribeImageProjectPath(resolve) : undefined;
    return () => {
      active = false;
      watchFailures?.();
      unsubscribe?.();
    };
  }, [source]);

  const style: CSSProperties = {
    width: `${geometry.width * 100}%`,
    height: `${geometry.height * 100}%`,
    left: `${geometry.left * 100}%`,
    top: `${geometry.top * 100}%`,
  };

  if (!url || unreadable) {
    // The picture is gone, but its description still belongs to the page.
    const description = alt === "" ? undefined : (alt ?? element.altText);
    const marker = [className, "image-missing"].filter(Boolean).join(" ");
    return (
      <div
        className={marker}
        style={style}
        role={description ? "img" : undefined}
        aria-label={description}
        title={description}
      />
    );
  }

  return (
    <img
      className={className}
      style={style}
      src={url}
      alt={alt ?? element.altText}
      draggable={false}
      onError={() => setUnreadable(true)}
    />
  );
}

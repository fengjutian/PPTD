import { useEffect, useState, type CSSProperties } from "react";
import type { ImageElement } from "../../core/document-model";
import { cropGeometry } from "../../core/rendering/image-crop";
import { isAssetReference, peekImageUrl, resolveImageUrl } from "../../services/image-url-service";

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
 */
export function CroppedImage({ element, className, alt }: CroppedImageProps) {
  const geometry = cropGeometry(element.crop);
  const source = element.source.dataUrl;
  const [url, setUrl] = useState<string | undefined>(() =>
    isAssetReference(source) ? peekImageUrl(source) : source,
  );

  useEffect(() => {
    let active = true;
    if (isAssetReference(source)) {
      void resolveImageUrl(source).then((resolved) => {
        if (active) setUrl(resolved);
      });
    } else {
      setUrl(source);
    }
    return () => {
      active = false;
    };
  }, [source]);

  const style: CSSProperties = {
    width: `${geometry.width * 100}%`,
    height: `${geometry.height * 100}%`,
    left: `${geometry.left * 100}%`,
    top: `${geometry.top * 100}%`,
  };

  if (!url) return <div className={className} style={style} aria-hidden />;

  return (
    <img
      className={className}
      style={style}
      src={url}
      alt={alt ?? element.altText}
      draggable={false}
    />
  );
}

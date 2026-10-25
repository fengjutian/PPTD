import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide, SlideAnimation } from "../core/document-model";
import type { AnimationEffect } from "../core/document-model";

export function useAnimationPreview({
  activeSlide,
  selectedElementId,
}: {
  activeSlide: Slide;
  selectedElementId: string | null;
}) {
  const [animationPreviews, setAnimationPreviews] = useState<SlideAnimation[]>([]);
  const [selectedAnimationId, setSelectedAnimationId] = useState<string>();
  const [newAnimationEffect, setNewAnimationEffect] = useState<AnimationEffect>("fade");
  const animationPreviewTimers = useRef<number[]>([]);

  const selectedAnimations = selectedElementId
    ? (activeSlide.animations ?? []).filter((animation) => animation.elementId === selectedElementId)
    : [];
  const selectedAnimation =
    selectedAnimations.find((animation) => animation.id === selectedAnimationId) ?? selectedAnimations.at(-1);
  const selectedAnimationIndex = selectedAnimation
    ? (activeSlide.animations ?? []).findIndex((animation) => animation.id === selectedAnimation.id)
    : -1;

  useEffect(() => {
    const nextId = selectedAnimation?.id;
    if (selectedAnimationId !== nextId) setSelectedAnimationId(nextId);
  }, [selectedAnimation?.id, selectedAnimationId]);

  const stopAnimationPreview = useCallback(() => {
    animationPreviewTimers.current.forEach((timer) => window.clearTimeout(timer));
    animationPreviewTimers.current = [];
    setAnimationPreviews([]);
  }, []);

  useEffect(() => stopAnimationPreview, [stopAnimationPreview]);

  const previewSelectedAnimation = () => {
    if (!selectedAnimation) return;
    stopAnimationPreview();
    window.requestAnimationFrame(() => {
      setAnimationPreviews([selectedAnimation]);
      animationPreviewTimers.current = [
        window.setTimeout(
          () => setAnimationPreviews([]),
          selectedAnimation.durationMs + selectedAnimation.delayMs + 120,
        ),
      ];
    });
  };

  const previewSlideAnimations = () => {
    const animations = activeSlide.animations ?? [];
    if (animations.length === 0) return;
    stopAnimationPreview();
    let previousStart = 0;
    let previousEnd = 0;
    animations.forEach((animation, index) => {
      const sequenceStart =
        index === 0
          ? 0
          : animation.start === "with-previous"
            ? previousStart
            : animation.start === "after-previous"
              ? previousEnd
              : previousEnd + 250;
      const visibleStart = sequenceStart;
      const visibleEnd = sequenceStart + animation.delayMs + animation.durationMs + 80;
      animationPreviewTimers.current.push(
        window.setTimeout(() => {
          setAnimationPreviews((current) => [
            ...current.filter((item) => item.elementId !== animation.elementId),
            animation,
          ]);
          setSelectedAnimationId(animation.id);
        }, visibleStart),
        window.setTimeout(() => {
          setAnimationPreviews((current) => current.filter((item) => item.id !== animation.id));
        }, visibleEnd),
      );
      previousStart = sequenceStart;
      previousEnd = Math.max(previousEnd, sequenceStart + animation.delayMs + animation.durationMs);
    });
    animationPreviewTimers.current.push(
      window.setTimeout(() => {
        animationPreviewTimers.current = [];
        setAnimationPreviews([]);
      }, previousEnd + 350),
    );
  };

  return {
    animationPreviews,
    selectedAnimation,
    selectedAnimationIndex,
    selectedAnimationId,
    setSelectedAnimationId,
    newAnimationEffect,
    setNewAnimationEffect,
    stopAnimationPreview,
    previewSelectedAnimation,
    previewSlideAnimations,
  };
}

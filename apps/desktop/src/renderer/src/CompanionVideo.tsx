import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionMood } from "../../shared/desktop-companion";
import {
  type CompanionClip,
  type CompanionMotionId,
  type CompanionMotionRequest,
  CompanionMotionScheduler,
} from "./lib/companion-motion";

const MOTION_URLS = import.meta.glob<string>("../companion-assets/motions/*.webm", {
  eager: true,
  import: "default",
  query: "?url",
});
const LOAD_TIMEOUT_MS = 8_000;

interface VideoSlot {
  clip: CompanionClip;
  source: string;
  token: number;
}

interface CompanionVideoProps {
  mood: CompanionMood;
  request: CompanionMotionRequest | null;
  enabled: boolean;
  idleAllowed?: boolean;
  greetingAllowed?: boolean;
  onVisibleChange(visible: boolean): void;
}

function motionSource(id: CompanionMotionId): string | undefined {
  return MOTION_URLS[`../companion-assets/motions/${id}.webm`];
}

function releaseVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function CompanionVideo({
  mood,
  request,
  enabled,
  idleAllowed = true,
  greetingAllowed = true,
  onVisibleChange,
}: CompanionVideoProps) {
  const scheduler = useRef(new CompanionMotionScheduler());
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null]);
  const activeSlot = useRef<number | null>(null);
  const activeClip = useRef<CompanionClip | null>(null);
  const pendingToken = useRef(0);
  const timeout = useRef<number | null>(null);
  const [slots, setSlots] = useState<[VideoSlot | null, VideoSlot | null]>([null, null]);
  const [visibleSlot, setVisibleSlot] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const pageVisible = usePageVisible();
  const active = enabled && !reduced && pageVisible;
  const activeRef = useRef(active);
  const latestRef = useRef({ mood, request });
  activeRef.current = active;
  latestRef.current = { mood, request };

  const clearLoadTimeout = useCallback(() => {
    if (timeout.current !== null) window.clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const fallback = useCallback(
    (clip: CompanionClip, token: number) => {
      if (pendingToken.current !== token) return;
      clearLoadTimeout();
      scheduler.current.fail(clip.id);
      pendingToken.current += 1;
      for (const video of videoRefs.current) releaseVideo(video);
      activeSlot.current = null;
      activeClip.current = null;
      setVisibleSlot(null);
      setSlots([null, null]);
      onVisibleChange(false);
    },
    [clearLoadTimeout, onVisibleChange],
  );

  const queueClip = useCallback(
    (clip: CompanionClip | null) => {
      if (!clip || !activeRef.current) return;
      clearLoadTimeout();
      if (activeClip.current?.automatic && !clip.automatic) {
        for (const video of videoRefs.current) releaseVideo(video);
        activeSlot.current = null;
        activeClip.current = null;
        setVisibleSlot(null);
        setSlots([null, null]);
        onVisibleChange(false);
      }
      const token = ++pendingToken.current;
      const source = motionSource(clip.id);
      if (!source) {
        fallback(clip, token);
        return;
      }
      const nextSlot = activeSlot.current === 0 ? 1 : 0;
      releaseVideo(videoRefs.current[nextSlot] ?? null);
      setSlots((current) => {
        const next: [VideoSlot | null, VideoSlot | null] = [...current];
        next[nextSlot] = { clip, source, token };
        return next;
      });
      timeout.current = window.setTimeout(() => fallback(clip, token), LOAD_TIMEOUT_MS);
    },
    [clearLoadTimeout, fallback, onVisibleChange],
  );

  useEffect(() => {
    if (!active) {
      pendingToken.current += 1;
      clearLoadTimeout();
      scheduler.current.reset(mood, request);
      for (const video of videoRefs.current) releaseVideo(video);
      activeSlot.current = null;
      activeClip.current = null;
      setVisibleSlot(null);
      setSlots([null, null]);
      onVisibleChange(false);
      return;
    }
    queueClip(scheduler.current.update(mood, request, idleAllowed, greetingAllowed));
  }, [
    active,
    clearLoadTimeout,
    greetingAllowed,
    idleAllowed,
    mood,
    onVisibleChange,
    queueClip,
    request,
  ]);

  useEffect(
    () => () => {
      pendingToken.current += 1;
      clearLoadTimeout();
      scheduler.current.reset(latestRef.current.mood, latestRef.current.request);
      for (const video of videoRefs.current) releaseVideo(video);
    },
    [clearLoadTimeout],
  );

  const startSlot = useCallback(
    async (index: number, slot: VideoSlot) => {
      const video = videoRefs.current[index];
      if (!video || !activeRef.current || slot.token !== pendingToken.current) return;
      try {
        video.playbackRate = slot.clip.playbackRate ?? 1;
        await video.play();
        if (!activeRef.current || slot.token !== pendingToken.current) {
          video.pause();
          return;
        }
        clearLoadTimeout();
        const previous = activeSlot.current;
        activeSlot.current = index;
        activeClip.current = slot.clip;
        setVisibleSlot(index);
        onVisibleChange(true);
        if (previous !== null && previous !== index) videoRefs.current[previous]?.pause();
      } catch {
        fallback(slot.clip, slot.token);
      }
    },
    [clearLoadTimeout, fallback, onVisibleChange],
  );

  return (
    <>
      {slots.map((slot, index) => (
        <video
          // Replacing the inactive slot prevents a stale decoder from holding its old source.
          key={`${index === 0 ? "first" : "second"}-${slot?.token ?? "empty"}`}
          ref={(element) => {
            videoRefs.current[index] = element;
          }}
          className={`companion-video${visibleSlot === index ? " is-visible" : ""}`}
          src={slot?.source}
          data-motion={visibleSlot === index ? slot?.clip.id : undefined}
          loop={slot?.clip.loop ?? false}
          muted
          playsInline
          preload={slot ? "auto" : "none"}
          onLoadedData={() => {
            if (slot) void startSlot(index, slot);
          }}
          onError={() => {
            if (slot) fallback(slot.clip, slot.token);
          }}
          onEnded={() => {
            if (!slot || activeSlot.current !== index || slot.token !== pendingToken.current)
              return;
            queueClip(scheduler.current.complete(slot.clip.id));
          }}
        />
      ))}
    </>
  );
}

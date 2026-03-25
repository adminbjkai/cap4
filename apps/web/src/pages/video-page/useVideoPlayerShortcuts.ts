import { useCallback } from "react";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

export function useVideoPlayerShortcuts(requestSeek: (seconds: number) => void) {
  const getActiveVideoElement = useCallback((): HTMLVideoElement | null => {
    return document.querySelector("video");
  }, []);

  const togglePlayerPlayback = useCallback(() => {
    const video = getActiveVideoElement();
    if (!video) return;
    if (video.paused) {
      void video.play();
      return;
    }
    video.pause();
  }, [getActiveVideoElement]);

  const seekPlayerBy = useCallback((deltaSeconds: number) => {
    const video = getActiveVideoElement();
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    const nextTime = Math.max(0, Math.min(duration, video.currentTime + deltaSeconds));
    requestSeek(nextTime);
  }, [getActiveVideoElement, requestSeek]);

  const seekPlayerToPercent = useCallback((percent: number) => {
    const video = getActiveVideoElement();
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    requestSeek(video.duration * Math.max(0, Math.min(1, percent)));
  }, [getActiveVideoElement, requestSeek]);

  const adjustPlayerVolume = useCallback((delta: number) => {
    const video = getActiveVideoElement();
    if (!video) return;
    const nextVolume = Math.max(0, Math.min(1, video.volume + delta));
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
  }, [getActiveVideoElement]);

  const adjustPlayerRate = useCallback((delta: number) => {
    const video = getActiveVideoElement();
    if (!video) return;
    const nextRate = Math.max(0.25, Math.min(3, video.playbackRate + delta));
    video.playbackRate = Math.round(nextRate * 100) / 100;
  }, [getActiveVideoElement]);

  const togglePlayerMute = useCallback(() => {
    const video = getActiveVideoElement();
    if (!video) return;
    video.muted = !video.muted;
  }, [getActiveVideoElement]);

  const togglePlayerFullscreen = useCallback(() => {
    const video = getActiveVideoElement();
    if (!video) return;
    const host = (video.closest(".custom-video-shell") as HTMLElement | null) ?? video;
    if (document.fullscreenElement === host) {
      void document.exitFullscreen();
      return;
    }
    void host.requestFullscreen();
  }, [getActiveVideoElement]);

  useKeyboardShortcuts({
    player: {
      enabled: true,
      onPlayPause: togglePlayerPlayback,
      onSeekBy: seekPlayerBy,
      onSeekToPercent: seekPlayerToPercent,
      onVolumeBy: adjustPlayerVolume,
      onRateBy: adjustPlayerRate,
      onToggleMute: togglePlayerMute,
      onToggleFullscreen: togglePlayerFullscreen,
    },
  });
}

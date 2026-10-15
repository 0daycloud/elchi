import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play } from "lucide-react";

const BARS = 28;

/** Only one recording plays at a time across the feed. */
let playing: HTMLAudioElement | null = null;

/** The loudness of a recording in `BARS` buckets (0..1), read from the file
 *  itself, and its length. Null when the file cannot be read or decoded. */
const analyse = async (
  src: string,
): Promise<{ peaks: number[]; duration: number } | null> => {
  try {
    const buf = await (await fetch(src)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 16000);
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / BARS));
    const rms = Array.from({ length: BARS }, (_, b) => {
      let sum = 0;
      for (let i = b * size; i < Math.min(data.length, (b + 1) * size); i++)
        sum += data[i] * data[i];
      return Math.sqrt(sum / size);
    });
    const max = Math.max(...rms, 1e-6);
    return { peaks: rms.map((v) => v / max), duration: audio.duration };
  } catch {
    return null;
  }
};

const clock = (s: number) =>
  Number.isFinite(s)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "0:00";

/**
 * A dictation's recording, small: a blue gem to play, the recording's own
 * loudness as bars (lit as it plays, click or arrow keys to seek) and its
 * length. The file is fetched the first time the row is hovered (`warm`) so
 * the bars and length are there before play is pressed.
 */
export const MiniPlayer: React.FC<{
  load: () => Promise<string | null>;
  warm: boolean;
  onActiveChange?: (active: boolean) => void;
}> = ({ load, warm, onActiveChange }) => {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const pending = useRef<Promise<string | null> | null>(null);

  const resolve = useCallback(() => {
    if (!pending.current)
      pending.current = load().then(async (url) => {
        if (!url) {
          setFailed(true);
          return null;
        }
        setSrc(url);
        const a = await analyse(url);
        if (a) {
          setPeaks(a.peaks);
          setDuration((d) => d || a.duration);
        }
        return url;
      });
    return pending.current;
  }, [load]);

  useEffect(() => {
    if (warm) resolve();
  }, [warm, resolve]);

  useEffect(
    () => () => {
      if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
    },
    [src],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let raf = 0;
    const tick = () => {
      setTime(audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      setIsPlaying(true);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      if (playing === audio) playing = null;
      setIsPlaying(false);
      cancelAnimationFrame(raf);
      setTime(audio.currentTime);
    };
    const onMeta = () => setDuration(audio.duration || 0);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("loadedmetadata", onMeta);
    return () => {
      cancelAnimationFrame(raf);
      if (playing === audio) playing = null;
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  useEffect(() => {
    onActiveChange?.(isPlaying);
  }, [isPlaying, onActiveChange]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    const url = src ?? (await resolve());
    if (!url) return;
    if (audio.src !== url) audio.src = url;
    if (duration > 0 && duration - audio.currentTime < 0.05)
      audio.currentTime = 0;
    audio.play().catch(() => setFailed(true));
  };

  const seek = (v: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src && src) audio.src = src;
    audio.currentTime = v;
    setTime(v);
  };

  if (failed) return null;

  const progress = duration > 0 ? time / duration : 0;

  return (
    <div className="flex items-center gap-2">
      <audio ref={audioRef} preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? t("home.player.pause") : t("home.player.play")}
        className="gem size-[22px] flex-none grid place-items-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {isPlaying ? (
          <Pause size={9} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play
            size={9}
            fill="currentColor"
            strokeWidth={0}
            className="translate-x-[0.5px]"
          />
        )}
      </button>
      <div className="relative flex items-end gap-[2px] h-[14px]">
        {Array.from({ length: BARS }, (_, i) => {
          const lit = (i + 0.5) / BARS <= progress;
          const h = peaks ? 2 + Math.round(peaks[i] * 12) : 2;
          return (
            <span
              key={i}
              aria-hidden="true"
              className="w-[3px]"
              style={{
                height: h,
                background: `repeating-linear-gradient(0deg, ${
                  lit
                    ? "#6F87FF"
                    : "color-mix(in srgb, var(--color-text) 40%, transparent)"
                } 0 2px, transparent 2px 3px)`,
              }}
            />
          );
        })}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          onChange={(e) => seek(parseFloat(e.target.value))}
          aria-label={t("home.player.seek")}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
        />
      </div>
      <span className="font-mono text-[10px] text-[color:var(--text-faint)] tabular-nums min-w-[26px]">
        {isPlaying || time > 0 ? clock(time) : duration ? clock(duration) : ""}
      </span>
    </div>
  );
};

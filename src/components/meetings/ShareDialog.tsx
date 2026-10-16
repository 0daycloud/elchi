import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { commands, type Meeting } from "@/bindings";
import { ChipButton, GhostButton } from "../home/FeedRow";

/** 16 kHz, 16-bit mono: what the mixed recording weighs per second. */
const BYTES_PER_SECOND = 32_000;

const errorKey = (code: string) =>
  ["needs_pro", "too_long", "failed", "unshare_failed"].includes(code)
    ? code
    : "failed";

/** One thing the link can carry, with why it can't when it can't. */
const Option: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, hint, checked, disabled, onChange }) => (
  <label
    className={`flex items-start gap-2.5 text-[14px] leading-[1.4] ${
      disabled ? "opacity-50 cursor-default" : "cursor-pointer"
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-[2px] h-4 w-4 accent-[color:var(--color-accent)]"
    />
    <span className="flex flex-col">
      {label}
      {hint && <span className="text-[12.5px] text-mid-gray">{hint}</span>}
    </span>
  </label>
);

/** Sharing a finished meeting by link: pick what goes with the notes, make the link,
 *  then copy, open or stop it. Shared already, it opens on the link. */
export const ShareDialog: React.FC<{
  meeting: Meeting;
  hasRecording: boolean;
  onClose: () => void;
}> = ({ meeting: m, hasRecording, onClose }) => {
  const { t } = useTranslation();
  const [transcript, setTranscript] = useState(m.has_transcript);
  const [recording, setRecording] = useState(hasRecording);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [asking, setAsking] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const url = m.share_url;

  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);

  const seconds = m.ended_at ? m.ended_at - m.started_at : 0;
  const megabytes = Math.max(1, Math.round((seconds * BYTES_PER_SECOND) / 1e6));

  const create = async () => {
    setBusy(true);
    const r = await commands.shareMeeting(
      m.id,
      transcript && m.has_transcript,
      recording && hasRecording,
    );
    setBusy(false);
    if (r.status === "error") {
      toast.error(t(`meetings.share.errors.${errorKey(r.error)}`));
      return;
    }
    await navigator.clipboard.writeText(r.data).catch(() => {});
    toast.success(t("meetings.share.copied"));
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    linkRef.current?.select();
    toast.success(t("meetings.share.copied"));
  };

  const stop = async () => {
    if (!asking) {
      setAsking(true);
      return;
    }
    setStopping(true);
    const r = await commands.unshareMeeting(m.id);
    setStopping(false);
    setAsking(false);
    if (r.status === "error") {
      toast.error(t(`meetings.share.errors.${errorKey(r.error)}`));
      return;
    }
    toast.success(t("meetings.share.stopped"));
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-share-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="steel-panel max-w-[460px] w-full p-6 flex flex-col gap-4">
        <h2 id="meeting-share-title" className="text-[17px] font-medium">
          {t("meetings.share.title")}
        </h2>
        <p className="text-[14px] leading-[1.55] text-mid-gray">
          {t("meetings.share.body")}
        </p>

        {url ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="meeting-share-link"
                className="font-mono text-[10px] tracking-[0.12em] uppercase text-text/40"
              >
                {t("meetings.share.link")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="meeting-share-link"
                  ref={linkRef}
                  readOnly
                  value={url}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 rounded-md border border-mid-gray/30 bg-transparent px-2.5 py-1.5 font-mono text-[12.5px] select-all"
                />
                <ChipButton onClick={copy} autoFocus>
                  {t("meetings.share.copy")}
                </ChipButton>
              </div>
              <p className="text-[12.5px] text-mid-gray">
                {t("meetings.share.snapshot")}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <GhostButton
                onClick={stop}
                disabled={stopping}
                className={`!px-0 ${asking ? "!text-red-500" : ""}`}
              >
                {stopping && (
                  <Loader2
                    className="inline w-3 h-3 me-1 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {asking
                  ? t("meetings.share.stopConfirm")
                  : t("meetings.share.stop")}
              </GhostButton>
              <div className="flex gap-2">
                <GhostButton onClick={() => openUrl(url).catch(() => {})}>
                  {t("meetings.share.open")}
                </GhostButton>
                <ChipButton onClick={onClose}>
                  {t("meetings.share.close")}
                </ChipButton>
              </div>
            </div>
          </>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2.5" disabled={busy}>
              <legend className="mb-2 font-mono text-[10px] tracking-[0.12em] uppercase text-text/40">
                {t("meetings.share.include")}
              </legend>
              <Option
                label={t("meetings.share.transcript")}
                hint={
                  m.has_transcript ? undefined : t("meetings.share.notKept")
                }
                checked={transcript && m.has_transcript}
                disabled={!m.has_transcript}
                onChange={setTranscript}
              />
              <Option
                label={t("meetings.share.recording")}
                hint={
                  hasRecording
                    ? t("meetings.share.upload", { size: megabytes })
                    : t("meetings.share.notKept")
                }
                checked={recording && hasRecording}
                disabled={!hasRecording}
                onChange={setRecording}
              />
            </fieldset>
            <div className="flex items-center justify-end gap-2 pt-1">
              {busy && (
                <span className="me-auto flex items-center gap-2 text-[12.5px] text-mid-gray">
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  {recording && hasRecording
                    ? t("meetings.share.uploading")
                    : t("meetings.share.creating")}
                </span>
              )}
              <GhostButton onClick={onClose} disabled={busy}>
                {t("meetings.share.cancel")}
              </GhostButton>
              <ChipButton onClick={create} disabled={busy} autoFocus>
                {t("meetings.share.create")}
              </ChipButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

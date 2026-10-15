import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  commands,
  type ActiveMeeting,
  type Meeting,
  type MeetingDetail,
  type Segment,
} from "@/bindings";
import { useElchiPro } from "@/hooks/useElchiPro";
import { useSettings } from "@/hooks/useSettings";
import { ChipButton, GhostButton } from "../home/FeedRow";
import { MiniPlayer } from "../home/MiniPlayer";
import { useIsDark } from "../home/useIsDark";
import { NotesMarkdown } from "./NotesMarkdown";
import {
  useActiveMeeting,
  useLiveMeeting,
  useMeetingList,
} from "./useMeetings";

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="font-mono text-[10px] tracking-[0.12em] uppercase font-normal text-text/40">
    {children}
  </h2>
);

/** A two-step destructive button: the first click asks, the second does it. */
const ConfirmButton: React.FC<{
  label: string;
  confirm: string;
  onConfirm: () => void;
}> = ({ label, confirm, onConfirm }) => {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);
  return (
    <GhostButton
      onClick={() => (asking ? onConfirm() : setAsking(true))}
      className={asking ? "!text-red-500" : ""}
    >
      {asking ? confirm : label}
    </GhostButton>
  );
};

/** Before the first meeting: the people in it must be told it is recorded. */
const ConsentDialog: React.FC<{
  onAccept: () => void;
  onClose: () => void;
}> = ({ onAccept, onClose }) => {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-consent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="steel-panel max-w-[460px] w-full p-6 flex flex-col gap-3">
        <h2 id="meeting-consent-title" className="text-[17px] font-medium">
          {t("meetings.consent.title")}
        </h2>
        <p className="text-[14px] leading-[1.55] text-mid-gray">
          {t("meetings.consent.body")}
        </p>
        <p className="text-[14px] leading-[1.55] text-mid-gray">
          {t("meetings.consent.privacy")}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>
            {t("meetings.consent.cancel")}
          </GhostButton>
          <ChipButton onClick={onAccept} autoFocus>
            {t("meetings.consent.accept")}
          </ChipButton>
        </div>
      </div>
    </div>
  );
};

const Meter: React.FC<{ label: string; level: number }> = ({
  label,
  level,
}) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <span className="w-[86px] flex-none font-mono text-[10px] tracking-[0.08em] uppercase text-[color:var(--text-faint)]">
      {label}
    </span>
    <span className="relative h-1.5 flex-1 rounded-full bg-mid-gray/15 overflow-hidden">
      <span
        className="absolute inset-y-0 start-0 rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.sqrt(level) * 260)}%` }}
      />
    </span>
  </div>
);

const TranscriptLines: React.FC<{ segments: Segment[]; follow?: boolean }> = ({
  segments,
  follow,
}) => {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: "end" });
  }, [segments.length, follow]);
  return (
    <div className="flex flex-col gap-2.5 select-text cursor-text">
      {segments.map((s) => (
        <p key={s.id} className="text-[14.5px] leading-[1.5]">
          <span
            className={`me-2 font-mono text-[10px] tracking-[0.08em] uppercase ${
              s.speaker === "me"
                ? "text-accent"
                : "text-[color:var(--text-faint)]"
            }`}
          >
            {s.speaker === "me" ? t("meetings.me") : t("meetings.them")}{" "}
            {clock(s.start_ms / 1000)}
          </span>
          {s.text}
        </p>
      ))}
      <div ref={end} />
    </div>
  );
};

/** The meeting being recorded: time, both sides' levels, the transcript as it comes, and
 *  the user's own notes, which the notes are written around. */
const LiveMeeting: React.FC<{
  active: ActiveMeeting;
  onStopped: (id: number) => void;
}> = ({ active, onStopped }) => {
  const { t } = useTranslation();
  const { segments, levels } = useLiveMeeting(active.id);
  const [now, setNow] = useState(Date.now());
  const [notes, setNotes] = useState("");
  const [stopping, setStopping] = useState(false);
  const saved = useRef("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    commands.getMeeting(active.id).then((r) => {
      if (r.status === "ok") {
        setNotes(r.data.meeting.user_notes);
        saved.current = r.data.meeting.user_notes;
      }
    });
  }, [active.id]);

  const save = useCallback(
    async (text: string) => {
      if (text === saved.current) return;
      saved.current = text;
      await commands.setMeetingUserNotes(active.id, text);
    },
    [active.id],
  );

  useEffect(() => {
    const timer = setTimeout(() => save(notes), 600);
    return () => clearTimeout(timer);
  }, [notes, save]);

  const stop = async () => {
    setStopping(true);
    await save(notes);
    const r = await commands.stopMeeting();
    if (r.status === "error") {
      toast.error(r.error);
      setStopping(false);
      return;
    }
    onStopped(r.data);
  };

  const cancel = async () => {
    const r = await commands.cancelMeeting();
    if (r.status === "error") toast.error(r.error);
  };

  return (
    <section
      aria-label={t("meetings.live.label")}
      className="steel-panel p-5 flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] uppercase">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-red-500 animate-pulse"
          />
          {t("meetings.live.recording")} ·{" "}
          {clock(now / 1000 - active.started_at)}
        </span>
        <span className="flex-1" />
        <ConfirmButton
          label={t("meetings.live.cancel")}
          confirm={t("meetings.live.cancelConfirm")}
          onConfirm={cancel}
        />
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="chrome-cta inline-flex items-center gap-1.5 px-3.5 py-[9px] text-[13px] leading-none disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          {stopping && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t("meetings.live.stop")}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Meter label={t("meetings.me")} level={levels.me} />
        {active.call_audio ? (
          <Meter label={t("meetings.them")} level={levels.them} />
        ) : (
          <p className="text-[12.5px] text-mid-gray">
            {t("meetings.live.micOnly")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 max-[760px]:grid-cols-1 gap-4">
        <label className="flex flex-col gap-2">
          <Label>{t("meetings.yourNotes")}</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => save(notes)}
            placeholder={t("meetings.live.notesPlaceholder")}
            className="min-h-[220px] resize-y rounded-lg border border-mid-gray/20 bg-background/60 px-3 py-2.5 text-[14.5px] leading-[1.5] select-text focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        <div className="flex flex-col gap-2 min-w-0">
          <Label>{t("meetings.transcript")}</Label>
          <div className="max-h-[300px] overflow-y-auto pe-1">
            {segments.length === 0 ? (
              <p className="text-[13px] text-mid-gray">
                {t("meetings.live.waiting")}
              </p>
            ) : (
              <TranscriptLines segments={segments} follow />
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const meetingTitle = (m: Meeting, t: (k: string) => string) =>
  m.title.trim() || t("meetings.untitled");

/** A finished meeting: its notes, the user's own notes, and what is kept of it. */
const MeetingView: React.FC<{ id: number; onBack: () => void }> = ({
  id,
  onBack,
}) => {
  const { t, i18n } = useTranslation();
  const { status, upgrade } = useElchiPro();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [audio, setAudio] = useState<{
    me: string | null;
    them: string | null;
  }>({
    me: null,
    them: null,
  });

  const load = useCallback(async () => {
    const r = await commands.getMeeting(id);
    if (r.status === "ok") setDetail(r.data);
    else onBack();
  }, [id, onBack]);

  useEffect(() => {
    load();
    const un = listen("meetings-changed", load);
    return () => {
      un.then((f) => f());
    };
  }, [load]);

  useEffect(() => {
    if (!detail?.meeting.kept) return;
    Promise.all([
      commands.meetingAudioPath(id, "me"),
      commands.meetingAudioPath(id, "them"),
    ]).then(([me, them]) => setAudio({ me, them }));
  }, [id, detail?.meeting.kept]);

  if (!detail) return null;
  const m = detail.meeting;
  const started = new Date(m.started_at * 1000);
  const minutes = m.ended_at
    ? Math.max(1, Math.round((m.ended_at - m.started_at) / 60))
    : null;
  const pro = !!status?.cloud_active;

  const copy = async () => {
    await navigator.clipboard.writeText(
      [m.title && `# ${m.title}`, m.notes].filter(Boolean).join("\n\n"),
    );
    toast.success(t("meetings.copied"));
  };
  const retry = async () => {
    const r = await commands.retryMeetingNotes(id);
    if (r.status === "error") toast.error(r.error);
  };
  const remove = async () => {
    const r = await commands.deleteMeeting(id);
    if (r.status === "error") toast.error(r.error);
    else onBack();
  };

  return (
    <article className="flex flex-col gap-5">
      <div>
        <GhostButton onClick={onBack} className="!px-0">
          <ArrowLeft className="inline w-3 h-3 me-1" aria-hidden="true" />
          {t("meetings.all")}
        </GhostButton>
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] leading-tight tracking-[-0.01em] font-medium select-text">
          {meetingTitle(m, t)}
        </h1>
        <p className="font-mono text-[11px] tracking-[0.04em] uppercase text-[color:var(--text-faint)]">
          {started.toLocaleString(i18n.language, {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {minutes !== null &&
            ` · ${t("meetings.minutes", { count: minutes })}`}
        </p>
      </header>

      {m.status === "processing" && (
        <p className="flex items-center gap-2 text-[14px] text-mid-gray">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          {t("meetings.writing")}
        </p>
      )}
      {m.status === "empty" && (
        <p className="text-[14px] text-mid-gray">{t("meetings.empty")}</p>
      )}
      {(m.status === "no_notes" || m.status === "interrupted") && (
        <div className="steel-panel px-5 py-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[220px] text-[14px] leading-[1.5]">
            {!pro
              ? t("meetings.proOnly")
              : m.status === "interrupted"
                ? t("meetings.interrupted")
                : t("meetings.failed")}
          </p>
          {!pro ? (
            <ChipButton
              onClick={() =>
                upgrade().catch(() => toast.error(t("elchiPro.upgradeFailed")))
              }
            >
              {t("meetings.upgrade")}
            </ChipButton>
          ) : (
            m.has_transcript && (
              <ChipButton onClick={retry}>{t("meetings.retry")}</ChipButton>
            )
          )}
        </div>
      )}

      {m.notes && (
        <section className="flex flex-col gap-3">
          <NotesMarkdown markdown={m.notes} />
        </section>
      )}

      {m.user_notes.trim() && (
        <section className="flex flex-col gap-2">
          <Label>{t("meetings.yourNotes")}</Label>
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.5] text-mid-gray select-text cursor-text">
            {m.user_notes}
          </p>
        </section>
      )}

      {(audio.me || audio.them) && (
        <section className="flex flex-col gap-2">
          <Label>{t("meetings.recording")}</Label>
          {audio.me && (
            <div className="flex items-center gap-3">
              <span className="w-[86px] font-mono text-[10px] tracking-[0.08em] uppercase text-[color:var(--text-faint)]">
                {t("meetings.me")}
              </span>
              <MiniPlayer
                load={async () => convertFileSrc(audio.me!, "asset")}
                warm
              />
            </div>
          )}
          {audio.them && (
            <div className="flex items-center gap-3">
              <span className="w-[86px] font-mono text-[10px] tracking-[0.08em] uppercase text-[color:var(--text-faint)]">
                {t("meetings.them")}
              </span>
              <MiniPlayer
                load={async () => convertFileSrc(audio.them!, "asset")}
                warm
              />
            </div>
          )}
        </section>
      )}

      {detail.segments.length > 0 && (
        <details className="group" open={!m.notes}>
          <summary className="cursor-pointer list-none">
            <Label>
              {t("meetings.transcript")} · {detail.segments.length}
            </Label>
          </summary>
          <div className="pt-3">
            <TranscriptLines segments={detail.segments} />
          </div>
        </details>
      )}

      <div className="flex items-center gap-1.5 pt-1">
        {m.notes && (
          <ChipButton onClick={copy}>{t("meetings.copy")}</ChipButton>
        )}
        <ConfirmButton
          label={t("meetings.delete")}
          confirm={t("meetings.deleteConfirm")}
          onConfirm={remove}
        />
      </div>
    </article>
  );
};

const statusLabel = (m: Meeting, t: (k: string) => string) =>
  ({
    recording: t("meetings.status.recording"),
    processing: t("meetings.status.processing"),
    no_notes: t("meetings.status.noNotes"),
    interrupted: t("meetings.status.interrupted"),
    empty: t("meetings.status.empty"),
  })[m.status] ?? "";

/**
 * Meetings: record a call (the user's microphone and the call's audio as two tracks,
 * nothing joins it), see the transcript as it goes, jot notes, and get the notes written
 * when it ends (Duyu Pro). Past meetings below.
 */
export const Meetings: React.FC<{
  onBack: () => void;
  initialId?: number | null;
}> = ({ onBack, initialId = null }) => {
  const { t, i18n } = useTranslation();
  const dark = useIsDark();
  const { getSetting, refreshSettings } = useSettings();
  const { status } = useElchiPro();
  const { active, refresh: refreshActive } = useActiveMeeting();
  const { meetings } = useMeetingList();
  const [selected, setSelected] = useState<number | null>(initialId);
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    const r = await commands.startMeeting();
    setStarting(false);
    if (r.status === "error")
      toast.error(t("meetings.startFailed", { error: r.error }));
    else {
      setSelected(null);
      refreshActive();
    }
  };

  const onStart = () => {
    if (getSetting("meeting_consent_ack")) start();
    else setAsking(true);
  };

  const accept = async () => {
    setAsking(false);
    await commands.acknowledgeMeetingConsent();
    await refreshSettings();
    start();
  };

  const past = (meetings ?? []).filter((m) => m.id !== active?.id);

  return (
    <div
      className={`h-screen flex flex-col bg-background select-none cursor-default ${dark ? "grain" : ""}`}
    >
      <header className="steel-bar relative z-10 flex-none h-14 px-7 max-[720px]:px-5 flex items-center gap-4">
        <GhostButton onClick={onBack} className="!px-1">
          <ArrowLeft className="inline w-3 h-3 me-1" aria-hidden="true" />
          {t("meetings.back")}
        </GhostButton>
        <h1 className="font-mono text-[11px] tracking-[0.1em] uppercase">
          {t("meetings.title")}
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[880px] mx-auto px-7 max-[720px]:px-5 pt-7 pb-10 flex flex-col gap-6">
          {selected !== null ? (
            <MeetingView id={selected} onBack={() => setSelected(null)} />
          ) : (
            <>
              {active ? (
                <LiveMeeting
                  active={active}
                  onStopped={(id) => setSelected(id)}
                />
              ) : (
                <section className="steel-panel px-6 py-5 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[240px] flex flex-col gap-1">
                    <h2 className="text-[16px] font-medium">
                      {t("meetings.new.title")}
                    </h2>
                    <p className="text-[13.5px] leading-[1.5] text-mid-gray">
                      {status?.cloud_active
                        ? t("meetings.new.body")
                        : t("meetings.new.bodyFree")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onStart}
                    disabled={starting}
                    className="chrome-cta inline-flex items-center gap-1.5 px-3.5 py-[9px] text-[13px] leading-none disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  >
                    {starting && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {t("meetings.new.start")}
                  </button>
                </section>
              )}

              {past.length > 0 && (
                <section className="flex flex-col">
                  <Label>{t("meetings.past")}</Label>
                  <ul className="pt-2">
                    {past.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(m.id)}
                          className="w-full text-start grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-3.5 hairline-t cursor-pointer hover:bg-mid-gray/5 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                        >
                          <span className="min-w-0 flex flex-col gap-1">
                            <span className="text-[15px] truncate">
                              {meetingTitle(m, t)}
                            </span>
                            <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-[color:var(--text-faint)]">
                              {new Date(m.started_at * 1000).toLocaleString(
                                i18n.language,
                                {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                              {m.ended_at &&
                                ` · ${t("meetings.minutes", {
                                  count: Math.max(
                                    1,
                                    Math.round(
                                      (m.ended_at - m.started_at) / 60,
                                    ),
                                  ),
                                })}`}
                            </span>
                          </span>
                          <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-[color:var(--text-faint)]">
                            {statusLabel(m, t)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {asking && (
        <ConsentDialog onAccept={accept} onClose={() => setAsking(false)} />
      )}
    </div>
  );
};

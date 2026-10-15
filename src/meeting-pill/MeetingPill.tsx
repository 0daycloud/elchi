import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { commands, type Segment } from "@/bindings";
import ElchiMark from "@/components/icons/ElchiMark";

/**
 * The meeting pill (src-tauri/src/meeting/pill.rs): Elchi's mark and a level meter at the
 * screen's edge while a meeting is recorded. Hovering it (the backend watches the cursor
 * and sends `meeting-pill-open`) opens the live transcript beside it; clicking it opens the
 * meeting in Elchi. Always dark, so it reads on any wallpaper or app.
 */
const MeetingPill: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [levels, setLevels] = useState({ me: 0, them: 0 });
  const [heard, setHeard] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let id: number | null = null;
    // The pill is reused from meeting to meeting: (re)load whichever one is on now.
    const load = async () => {
      const active = await commands.getActiveMeeting();
      if (!active || active.id === id) return;
      id = active.id;
      setSegments([]);
      const r = await commands.getMeeting(active.id);
      if (r.status === "ok") setSegments(r.data.segments);
    };
    load();
    const unChanged = listen("meetings-changed", load);
    const unOpen = listen<boolean>("meeting-pill-open", (e) =>
      setOpen(e.payload),
    );
    const unSegment = listen<{ meeting_id: number; segment: Segment }>(
      "meeting-segment",
      (e) => {
        if (id === null || e.payload.meeting_id === id)
          setSegments((s) => [...s, e.payload.segment]);
      },
    );
    const unLevel = listen<{ me: number; them: number }>(
      "meeting-level",
      (e) => {
        setLevels(e.payload);
        if (Math.max(e.payload.me, e.payload.them) > 0.02) setHeard(Date.now());
      },
    );
    return () => {
      unChanged.then((f) => f());
      unOpen.then((f) => f());
      unSegment.then((f) => f());
      unLevel.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end" });
  }, [open, segments.length]);

  // Someone spoke in the last few seconds and their words are not in yet.
  const listening = Date.now() - heard < 4000;
  const level = Math.min(1, Math.sqrt(Math.max(levels.me, levels.them)) * 2.6);
  const ink = levels.me >= levels.them ? "#8ea0ff" : "#ffffff";

  return (
    <div className="mp-stage">
      {open && (
        <section className="mp-panel" aria-label={t("meetings.live.rail")}>
          {segments.length === 0 && !listening && (
            <p className="mp-empty">{t("meetings.live.waiting")}</p>
          )}
          {segments.map((s) => (
            <p
              key={s.id}
              className={`mp-bubble ${s.speaker === "me" ? "me" : "them"}`}
            >
              {s.text}
            </p>
          ))}
          {listening && (
            <p
              className="mp-bubble them mp-listening"
              aria-label={t("meetings.pill.listening")}
            >
              <span />
              <span />
              <span />
            </p>
          )}
          <div ref={end} />
        </section>
      )}
      <button
        type="button"
        className="mp-pill"
        onClick={() => commands.openMeetingFromPill()}
        aria-label={t("meetings.pill.open")}
      >
        <ElchiMark size={20} color="#ffffff" />
        <span className="mp-bars" aria-hidden="true">
          {[0.55, 1, 0.7].map((k, i) => (
            <span
              key={i}
              style={{
                height: `${Math.max(4, level * k * 16)}px`,
                background: ink,
              }}
            />
          ))}
        </span>
      </button>
    </div>
  );
};

export default MeetingPill;

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type ActiveMeeting,
  type Meeting,
  type Segment,
} from "@/bindings";
import {
  insertSegment,
  type PartialPayload,
  type Partials,
} from "./liveTranscript";

/** The meeting being recorded, if any, kept current by the backend's events. */
export const useActiveMeeting = () => {
  const [active, setActive] = useState<ActiveMeeting | null>(null);
  const refresh = useCallback(async () => {
    setActive((await commands.getActiveMeeting()) ?? null);
  }, []);
  useEffect(() => {
    refresh();
    const un = listen("meetings-changed", refresh);
    return () => {
      un.then((f) => f());
    };
  }, [refresh]);
  return { active, refresh };
};

/** All meetings, newest first, refreshed whenever one changes. */
export const useMeetingList = () => {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const refresh = useCallback(async () => {
    const r = await commands.listMeetings();
    if (r.status === "ok") setMeetings(r.data);
  }, []);
  useEffect(() => {
    refresh();
    const un = listen("meetings-changed", refresh);
    return () => {
      un.then((f) => f());
    };
  }, [refresh]);
  return { meetings, refresh };
};

/** The live transcript of a meeting being recorded (in the order it was said), what each
 *  side is saying right now, and how loud each side is. */
export const useLiveMeeting = (id: number | null) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partials, setPartials] = useState<Partials>({ me: "", them: "" });
  const [levels, setLevels] = useState({ me: 0, them: 0 });
  useEffect(() => {
    setSegments([]);
    setPartials({ me: "", them: "" });
    if (id === null) return;
    commands.getMeeting(id).then((r) => {
      if (r.status === "ok")
        setSegments((live) => r.data.segments.reduce(insertSegment, live));
    });
    const unSegment = listen<{ meeting_id: number; segment: Segment }>(
      "meeting-segment",
      (e) => {
        if (e.payload.meeting_id === id)
          setSegments((s) => insertSegment(s, e.payload.segment));
      },
    );
    const unRemoved = listen<{ meeting_id: number; id: number }>(
      "meeting-segment-removed",
      (e) => {
        if (e.payload.meeting_id === id)
          setSegments((s) => s.filter((l) => l.id !== e.payload.id));
      },
    );
    const unPartial = listen<PartialPayload>("meeting-partial", (e) => {
      if (e.payload.meeting_id === id)
        setPartials((p) => ({ ...p, [e.payload.speaker]: e.payload.text }));
    });
    const unLevel = listen<{ me: number; them: number }>("meeting-level", (e) =>
      setLevels(e.payload),
    );
    return () => {
      unSegment.then((f) => f());
      unRemoved.then((f) => f());
      unPartial.then((f) => f());
      unLevel.then((f) => f());
    };
  }, [id]);
  return { segments, partials, levels };
};

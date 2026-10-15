import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type ActiveMeeting,
  type Meeting,
  type Segment,
} from "@/bindings";

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

/** The live transcript of a meeting being recorded, and how loud each side is. */
export const useLiveMeeting = (id: number | null) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [levels, setLevels] = useState({ me: 0, them: 0 });
  useEffect(() => {
    setSegments([]);
    if (id === null) return;
    commands.getMeeting(id).then((r) => {
      if (r.status === "ok") setSegments(r.data.segments);
    });
    const unSegment = listen<{ meeting_id: number; segment: Segment }>(
      "meeting-segment",
      (e) => {
        if (e.payload.meeting_id === id)
          setSegments((s) => [...s, e.payload.segment]);
      },
    );
    const unLevel = listen<{ me: number; them: number }>("meeting-level", (e) =>
      setLevels(e.payload),
    );
    return () => {
      unSegment.then((f) => f());
      unLevel.then((f) => f());
    };
  }, [id]);
  return { segments, levels };
};

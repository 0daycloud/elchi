import type { Segment } from "@/bindings";

/** What each side is saying right now, before its line is final. */
export type Partials = { me: string; them: string };

export type PartialPayload = {
  meeting_id: number;
  speaker: "me" | "them";
  text: string;
};

/**
 * A line put where it was said: the two sides arrive in their own time (the call's line
 * can land after the user's reply), so the transcript is kept in order of when each
 * started, the call first on a tie, as the backend orders it.
 */
export const insertSegment = (lines: Segment[], line: Segment): Segment[] => {
  if (lines.some((l) => l.id === line.id)) return lines;
  const before = (a: Segment, b: Segment) =>
    a.start_ms !== b.start_ms
      ? a.start_ms < b.start_ms
      : a.speaker !== b.speaker
        ? a.speaker === "them"
        : a.id < b.id;
  let at = lines.length;
  while (at > 0 && before(line, lines[at - 1])) at--;
  return [...lines.slice(0, at), line, ...lines.slice(at)];
};

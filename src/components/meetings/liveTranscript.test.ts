import { insertSegment } from "./liveTranscript";
import type { Segment } from "@/bindings";

const line = (id: number, speaker: string, start_ms: number): Segment => ({
  id,
  speaker,
  start_ms,
  end_ms: start_ms + 1000,
  text: `${id}`,
});

const order = (lines: Segment[]) => lines.map((l) => l.id).join(",");
const check = (got: string, want: string, what: string) => {
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
};

let lines: Segment[] = [];
lines = insertSegment(lines, line(1, "me", 5000));
lines = insertSegment(lines, line(2, "them", 2000)); // the call's line lands late
lines = insertSegment(lines, line(3, "me", 9000));
check(order(lines), "2,1,3", "late lines go where they were said");
lines = insertSegment(lines, line(4, "them", 5000));
check(order(lines), "2,4,1,3", "the call goes first on a tie");
check(
  order(insertSegment(lines, line(3, "me", 9000))),
  "2,4,1,3",
  "no duplicates",
);
console.log("liveTranscript: all checks passed");

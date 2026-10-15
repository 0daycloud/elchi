import type { HistoryEntry } from "@/bindings";

/** What was pasted: the formatted text when formatting produced one, the
 *  transcript as heard otherwise. */
export const pastedText = (e: HistoryEntry) =>
  e.post_processed_text ?? e.transcription_text;

/** The words of a text alone: lower case, no punctuation, single spaces. */
export const wordsOf = (text: string) =>
  text
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

export const countWords = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** YYYY-MM-DD in local time, the key the feed groups days by. */
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What changed between two versions of a text, word by word: up to `max` hunks
 *  of removed and added words ("petro" -> "spero"). */
export const wordChanges = (before: string, after: string, max = 3) => {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: { from: string; to: string }[] = [];
  let i = 0,
    j = 0,
    from: string[] = [],
    to: string[] = [];
  const flush = () => {
    if (from.length || to.length)
      hunks.push({ from: from.join(" "), to: to.join(" ") });
    from = [];
    to = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && dp[i + 1][j] >= dp[i][j + 1])
    ) {
      from.push(a[i++]);
    } else {
      to.push(b[j++]);
    }
  }
  flush();
  return hunks.slice(0, max);
};

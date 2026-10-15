// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/components/meetings/notesModel.test.ts
import assert from "node:assert";
import { openTasks, parseNotes, summaryOf, toggleTask } from "./notesModel";

const NOTES = `## lansman tarihi?
- Lansman **10 Kasım**'a alındı.
- Build en geç 6 Kasım'da.

## Fiyat 149 mu 129 mu
- 149 TL'de kalıyor.

## Diğer konular
- Pazarlama e-postayı bekliyor.

## Yapılacaklar
- [ ] Sen: e-postayı cumaya kadar Selin'e gönder
- - [x] Mert: App Store incelemesi  `;

const sections = parseNotes(NOTES, "- Lansman tarihi\nfiyat 149 mu 129 mu?\n");
assert.deepStrictEqual(
  sections.map((s) => [s.heading, s.mine, s.tasks]),
  [
    ["lansman tarihi?", true, false],
    ["Fiyat 149 mu 129 mu", true, false],
    ["Diğer konular", false, false],
    ["Yapılacaklar", false, true],
  ],
  "the user's own lines are found whatever their case and punctuation",
);
const tasks = sections[3].lines;
assert.deepStrictEqual(
  tasks.map((t) => t.kind === "task" && [t.text, t.done]),
  [
    ["Sen: e-postayı cumaya kadar Selin'e gönder", false],
    ["Mert: App Store incelemesi", true],
  ],
  "a to-do written as '- - [x]' is still a to-do",
);

const ticked = toggleTask(NOTES, tasks[0].at);
assert.strictEqual(openTasks(NOTES), 1);
assert.strictEqual(openTasks(ticked), 0);
assert.strictEqual(
  toggleTask(ticked, tasks[0].at),
  NOTES,
  "toggling twice restores the notes",
);

assert.strictEqual(
  summaryOf(NOTES),
  "Lansman 10 Kasım'a alındı. Build en geç 6 Kasım'da.",
);
assert.strictEqual(summaryOf("# Başlık\n\n## Kararlar\n- Cuma"), "Cuma.");
assert.strictEqual(summaryOf(null), "");

console.log("notesModel: all checks passed");

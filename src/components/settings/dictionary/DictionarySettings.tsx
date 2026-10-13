import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { Plus, X } from "lucide-react";
import { commands, type DictionaryWord } from "@/bindings";
import { useElchiPro } from "@/hooks/useElchiPro";
import { useSettings } from "@/hooks/useSettings";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

/**
 * The personal dictionary (src-tauri/src/dictionary): names, brands and terms,
 * learned from corrections or added here, with how Elchi misheard them.
 */
export const DictionarySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { status } = useElchiPro();
  const { getSetting, refreshSettings } = useSettings();
  const [words, setWords] = useState<DictionaryWord[]>([]);
  const [draft, setDraft] = useState("");
  const learning = getSetting("elchi_dictionary_learn") ?? true;
  const isMac = type() === "macos";

  useEffect(() => {
    commands.getDictionary().then(setWords);
    const unlisten = listen<DictionaryWord[]>("dictionary-changed", (e) =>
      setWords(e.payload),
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = draft.trim();
    if (!word) return;
    setWords(await commands.addDictionaryWord(word));
    setDraft("");
  };

  const sorted = [...words].sort((a, b) =>
    a.word.localeCompare(b.word, i18n.language),
  );

  return (
    <div className="max-w-3xl w-full mx-auto space-y-5">
      <section className="space-y-2 px-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">
            {t("dictionary.title")}
          </h2>
          <span className="text-sm text-mid-gray">
            {t("dictionary.count", { count: words.length })}
          </span>
        </div>
        <p className="text-[15px]">{t("dictionary.intro")}</p>
        <p className="text-sm text-mid-gray">
          {isMac ? t("dictionary.howMac") : t("dictionary.howOther")}
        </p>
      </section>

      {status && !status.format && (
        <p className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-2.5 text-sm">
          {t("dictionary.needsFormatting")}
        </p>
      )}

      <form onSubmit={add} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={40}
          placeholder={t("dictionary.addPlaceholder")}
          aria-label={t("dictionary.addPlaceholder")}
          className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-logo-primary/40"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-logo-primary px-4 py-2.5 font-semibold text-background disabled:opacity-40 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary/50"
        >
          <Plus size={16} aria-hidden="true" />
          {t("dictionary.add")}
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-mid-gray">
          {t("dictionary.empty")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={t("dictionary.title")}>
          {sorted.map((w) => (
            <li
              key={w.word}
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pl-3.5 pr-1.5"
            >
              <span className="font-semibold">{w.word}</span>
              {w.learned && (
                <span className="inline-flex items-center gap-1 text-xs text-coral">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-coral"
                    aria-hidden="true"
                  />
                  {t("dictionary.learned")}
                </span>
              )}
              {(w.heard ?? []).length > 0 && (
                <span className="text-xs text-mid-gray">
                  {t("dictionary.heardAs", {
                    forms: (w.heard ?? []).join(", "),
                  })}
                </span>
              )}
              <button
                type="button"
                onClick={async () =>
                  setWords(await commands.removeDictionaryWord(w.word))
                }
                aria-label={t("dictionary.remove", { word: w.word })}
                className="rounded-full p-1 text-mid-gray hover:bg-mid-gray/15 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary/50"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-border">
        <ToggleSwitch
          checked={learning}
          onChange={async (enabled) => {
            await commands.setDictionaryLearning(enabled);
            await refreshSettings();
          }}
          label={t("dictionary.learnToggle")}
          description={t("dictionary.learnToggleDescription")}
          descriptionMode="inline"
          grouped={true}
        />
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, Pencil, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  events,
  type DictationStats,
  type DictionaryWord,
  type HistoryEntry,
} from "@/bindings";
import { daysLeft, useElchiPro } from "@/hooks/useElchiPro";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import ElchiStar from "../icons/ElchiStar";
import ElchiLogo from "../icons/ElchiLogo";
import type { SidebarSection } from "../Sidebar";

/** How many of the latest dictations the feed shows; older ones live in History. */
const PAGE = 40;

/** Brand colours of the apps people dictate into most; anything else gets a hue
 *  from its name, so an app keeps its colour. */
const APP_COLORS: Record<string, string> = {
  mail: "#2f7de1",
  slack: "#4a154b",
  cursor: "#13232a",
  "vs code": "#0065a9",
  code: "#0065a9",
  chrome: "#1a73e8",
  "google chrome": "#1a73e8",
  safari: "#0a84ff",
  notes: "#d4a500",
  notlar: "#d4a500",
  whatsapp: "#25a855",
  telegram: "#2aabee",
  word: "#2b579a",
  "microsoft word": "#2b579a",
  outlook: "#0078d4",
  "microsoft outlook": "#0078d4",
  teams: "#5b5fc7",
  "microsoft teams": "#5b5fc7",
  notion: "#191919",
  terminal: "#2b2b2b",
  messages: "#34c759",
  mesajlar: "#34c759",
};

const appColor = (name: string) => {
  const known = APP_COLORS[name.toLowerCase()];
  if (known) return known;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 38%)`;
};

const pastedText = (e: HistoryEntry) =>
  e.post_processed_text ?? e.transcription_text;

/** The words of a text alone: lower case, no punctuation, single spaces. */
const wordsOf = (text: string) =>
  text
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

const countWords = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Item =
  | { kind: "dictation"; at: number; entry: HistoryEntry }
  | { kind: "learned"; at: number; word: DictionaryWord }
  | { kind: "streak"; at: number; days: number }
  | { kind: "milestone"; at: number; words: number };

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

const Avatar: React.FC<{ app?: string | null; icon?: string }> = ({
  app,
  icon,
}) =>
  icon ? (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      className="flex-none size-9 object-contain"
      draggable={false}
    />
  ) : app ? (
    <span
      aria-hidden="true"
      className="flex-none size-9 rounded-[10px] text-white font-bold text-[15px] flex items-center justify-center"
      style={{ background: appColor(app) }}
    >
      {app.trim()[0]?.toUpperCase()}
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="flex-none size-9 rounded-[10px] bg-mid-gray/20"
    />
  );

const ElchiAvatar: React.FC = () => (
  <span
    aria-hidden="true"
    className="flex-none size-9 rounded-full bg-logo-primary/10 flex items-center justify-center"
  >
    <ElchiStar size={22} ring="var(--color-background)" />
  </span>
);

const PostShell: React.FC<{
  avatar: React.ReactNode;
  name: string;
  when: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ avatar, name, when, children, actions }) => (
  <article className="group flex gap-3 py-3.5 border-b border-border">
    {avatar}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 text-[13.5px]">
        <span className="font-semibold">{name}</span>
        <span className="text-mid-gray">· {when}</span>
        {actions && (
          <span className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {actions}
          </span>
        )}
      </div>
      {children}
    </div>
  </article>
);

const IconAction: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="p-1.5 rounded-md text-mid-gray hover:text-logo-primary hover:bg-logo-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary/40"
  >
    {children}
  </button>
);

const DictationPost: React.FC<{
  entry: HistoryEntry;
  when: string;
  icon?: string;
}> = ({ entry, when, icon }) => {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [showHeard, setShowHeard] = useState(false);
  const text = pastedText(entry);
  const words = countWords(text);
  // What was pasted: before the user's correction, if they made one.
  const pasted = entry.edited_from ?? text;
  // "Formatted" only when the formatter changed the words (fillers dropped, a
  // correction resolved, a list made), not just capitals, punctuation or spacing,
  // which it touches in nearly every dictation.
  const formatted = wordsOf(pasted) !== wordsOf(entry.transcription_text);
  const changes = entry.edited_from ? wordChanges(entry.edited_from, text) : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* refused clipboard: nothing to do */
    }
  };

  const save = async () => {
    if (draft === null) return;
    const r = await commands.editHistoryText(entry.id, draft);
    if (r.status === "error") {
      toast.error(r.error);
      return;
    }
    setDraft(null);
  };

  return (
    <PostShell
      avatar={<Avatar app={entry.app_name} icon={icon} />}
      name={entry.app_name ?? t("home.unknownApp")}
      when={when}
      actions={
        draft === null && (
          <>
            <IconAction
              label={copied ? t("home.copied") : t("home.copy")}
              onClick={copy}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </IconAction>
            <IconAction label={t("home.fix")} onClick={() => setDraft(text)}>
              <Pencil size={15} />
            </IconAction>
          </>
        )
      }
    >
      {draft === null ? (
        <p className="text-[16px] leading-[1.42] mt-0.5 whitespace-pre-wrap break-words select-text cursor-text">
          {text}
        </p>
      ) : (
        <div className="mt-1.5 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            aria-label={t("home.fix")}
            rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
            className="w-full text-[15px] rounded-lg border border-logo-primary/60 bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-logo-primary/40"
          />
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-logo-primary px-3 py-1.5 font-semibold text-background hover:opacity-90"
            >
              {t("home.save")}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-lg px-3 py-1.5 hover:bg-mid-gray/10"
            >
              {t("home.cancel")}
            </button>
            <span className="text-xs text-mid-gray">{t("home.fixHint")}</span>
          </div>
        </div>
      )}
      {changes.length > 0 && (
        <p className="text-[13px] mt-1.5">
          <span className="font-semibold text-coral">
            {t("home.corrected")}
          </span>{" "}
          {changes.map((c, k) => (
            <span key={k} className="mr-2">
              {c.from && (
                <span className="line-through decoration-coral/70 text-mid-gray">
                  {c.from}
                </span>
              )}
              {c.from && c.to && <span className="text-mid-gray"> → </span>}
              {c.to && <span className="font-medium">{c.to}</span>}
            </span>
          ))}
        </p>
      )}
      <p className="text-[12.5px] text-mid-gray mt-1">
        {t("home.words", {
          count: words,
          n: new Intl.NumberFormat(i18n.language).format(words),
        })}
        {formatted && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setShowHeard((v) => !v)}
              aria-expanded={showHeard}
              className="text-logo-primary hover:underline focus:outline-none focus-visible:underline"
            >
              {t("home.formatted")} ·{" "}
              {showHeard ? t("home.hideHeard") : t("home.showHeard")}
            </button>
          </>
        )}
      </p>
      {formatted && showHeard && (
        <p className="mt-1.5 text-[13.5px] text-mid-gray border-l-2 border-border pl-3 whitespace-pre-wrap break-words select-text cursor-text">
          <span className="font-semibold">{t("home.heard")}</span>{" "}
          {entry.transcription_text}
        </p>
      )}
    </PostShell>
  );
};

const ElchiPost: React.FC<{
  when: string;
  title: string;
  body?: React.ReactNode;
  accent?: "coral" | "teal";
}> = ({ when, title, body, accent = "teal" }) => (
  <PostShell avatar={<ElchiAvatar />} name="Elchi" when={when}>
    <p className="text-[16px] leading-[1.42] mt-0.5">
      <b className={accent === "coral" ? "text-coral" : "text-logo-primary"}>
        {title}
      </b>{" "}
      {body}
    </p>
  </PostShell>
);

/**
 * Elchi's home: a timeline of what you dictated, newest first and grouped by
 * day, each post from the app it went into, with Elchi's own posts in between
 * (words it learned, streaks, milestones, the trial). Settings are behind the
 * gear.
 */
export const HomeFeed: React.FC<{
  onOpenSettings: (section?: SidebarSection) => void;
}> = ({ onOpenSettings }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { status, upgrade } = useElchiPro();
  const { settings } = useSettings();
  const osType = useOsType();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<DictationStats | null>(null);
  const [dictionary, setDictionary] = useState<DictionaryWord[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    commands.getHistoryEntries(null, PAGE).then((r) => {
      if (r.status === "ok") {
        setEntries(r.data.entries);
        setHasMore(r.data.has_more);
      }
    });
    commands.getDictationStats().then((r) => {
      if (r.status === "ok") setStats(r.data);
    });
    commands.getDictionary().then(setDictionary);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load();
    const unHistory = events.historyUpdatePayload.listen(load);
    const unDict = listen<DictionaryWord[]>("dictionary-changed", (e) =>
      setDictionary(e.payload),
    );
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener("focus", load);
    return () => {
      unHistory.then((f) => f());
      unDict.then((f) => f());
      clearInterval(tick);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // The apps' own icons (macOS), fetched once per app name.
  useEffect(() => {
    const names = [
      ...new Set(
        (entries ?? []).map((e) => e.app_name).filter((a): a is string => !!a),
      ),
    ].filter((a) => !(a in icons));
    if (!names.length) return;
    commands.getAppIcons(names).then((found) => {
      const urls: Record<string, string> = {};
      for (const [name, bytes] of Object.entries(found)) {
        if (bytes)
          urls[name] = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
      }
      // Remember the misses too, so they are not asked for again.
      setIcons((prev) => ({
        ...prev,
        ...Object.fromEntries(names.map((nm) => [nm, urls[nm] ?? ""])),
      }));
    });
  }, [entries, icons]);

  const n = (v: number) => new Intl.NumberFormat(lang).format(v);
  const minutes = (m: number) => {
    const r = Math.max(m > 0 ? 1 : 0, Math.round(m));
    return r >= 60
      ? t("summary.hoursMinutes", { h: Math.floor(r / 60), m: r % 60 })
      : t("summary.minutes", { m: r });
  };

  const items = useMemo<Item[]>(() => {
    const out: Item[] = (entries ?? [])
      .filter((e) => pastedText(e).trim())
      .map((e) => ({ kind: "dictation", at: e.timestamp * 1000, entry: e }));
    const oldest = out.length ? Math.min(...out.map((i) => i.at)) : now;
    for (const w of dictionary) {
      if (w.learned && (w.added_at ?? 0) * 1000 >= oldest)
        out.push({ kind: "learned", at: (w.added_at ?? 0) * 1000, word: w });
    }
    for (const m of stats?.milestones ?? []) {
      const at = Math.min(new Date(`${m.day}T23:59:00`).getTime(), now);
      if (at >= oldest) out.push({ kind: "milestone", at, words: m.words });
    }
    const today = out.filter(
      (i) => i.kind === "dictation" && dayKey(i.at) === dayKey(now),
    );
    if ((stats?.streak_days ?? 0) >= 3 && today.length) {
      // Right after the day's first dictation: that is when the streak grew.
      const first = Math.min(...today.map((i) => i.at));
      out.push({ kind: "streak", at: first + 1, days: stats!.streak_days });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [entries, dictionary, stats, now]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const k = dayKey(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()];
  }, [items]);

  const rtf = useMemo(
    () =>
      new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" }),
    [lang],
  );
  const when = (at: number) => {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (dayKey(at) !== dayKey(now))
      return new Date(at).toLocaleTimeString(lang, {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (s < 60) return rtf.format(0, "second");
    if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
    return rtf.format(-Math.floor(s / 3600), "hour");
  };
  const dayLabel = (k: string) => {
    if (k === dayKey(now)) return t("home.today");
    if (k === dayKey(now - 86_400_000)) return t("home.yesterday");
    return new Date(`${k}T12:00:00`).toLocaleDateString(lang, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  };

  const keys = formatKeyCombination(
    settings?.bindings?.transcribe?.current_binding ?? "",
    osType,
  );
  const plan = status?.plan;
  const trialDays = daysLeft(status?.trial_ends_at);

  return (
    <div className="h-screen flex flex-col bg-background select-none cursor-default">
      <header className="flex-none h-16 border-b border-border flex items-center gap-2.5 px-6">
        <ElchiLogo size={22} />
        {stats && stats.week_words > 0 && (
          <button
            type="button"
            onClick={() => onOpenSettings("summary")}
            className="ml-3 truncate text-[13.5px] text-mid-gray hover:text-text focus:outline-none focus-visible:underline"
          >
            {t("home.week")}{" "}
            <b className="text-text">
              {t("home.words", {
                count: stats.week_words,
                n: n(stats.week_words),
              })}
            </b>
            {stats.week_minutes_saved > 0 && (
              <>
                {" · "}
                <b className="text-coral">
                  ~{minutes(stats.week_minutes_saved)}
                </b>{" "}
                {t("home.saved")}
              </>
            )}
            {stats.streak_days > 1 && (
              <>
                {" · "}
                <b className="text-text">
                  {t("home.streakDays", { count: stats.streak_days })}
                </b>{" "}
                {t("home.streak")}
              </>
            )}
          </button>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-mid-gray whitespace-nowrap">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${status?.cloud_active ? "bg-green-500" : "bg-logo-primary"}`}
          />
          {status?.cloud_active ? t("home.engineCloud") : t("home.engineLocal")}
        </span>
        <button
          type="button"
          onClick={() => onOpenSettings()}
          title={t("home.settings")}
          aria-label={t("home.settings")}
          className="ml-1 size-9 rounded-[10px] flex items-center justify-center text-logo-primary bg-logo-primary/10 hover:bg-logo-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary/40"
        >
          <Settings size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[580px] mx-auto px-6 pb-10">
          {plan === "free" && (
            <ElchiPost
              when={t("home.today")}
              title={t("home.freeTitle")}
              accent="coral"
              body={
                <>
                  {t("home.freeBody")}{" "}
                  <button
                    type="button"
                    onClick={() => upgrade().catch(() => undefined)}
                    className="font-semibold text-coral underline underline-offset-2"
                  >
                    {t("elchiPro.cta")}
                  </button>
                </>
              }
            />
          )}
          {plan === "trial" && trialDays !== null && trialDays <= 3 && (
            <ElchiPost
              when={t("home.today")}
              title={t("home.trialTitle", { count: trialDays })}
              accent="coral"
              body={
                <>
                  {t("home.trialBody")}{" "}
                  <button
                    type="button"
                    onClick={() => upgrade().catch(() => undefined)}
                    className="font-semibold text-coral underline underline-offset-2"
                  >
                    {t("elchiPro.cta")}
                  </button>
                </>
              }
            />
          )}

          {entries !== null && items.length === 0 && (
            <ElchiPost
              when={t("home.today")}
              title={t("home.welcomeTitle")}
              body={t("home.welcomeBody", { keys: keys || "⌥ Space" })}
            />
          )}

          {groups.map(([day, list]) => (
            <section key={day} aria-label={dayLabel(day)}>
              <h2 className="pt-5 pb-0.5 text-[11.5px] font-bold uppercase tracking-[0.12em] text-mid-gray">
                {dayLabel(day)}
              </h2>
              {list.map((it) => {
                const w = when(it.at);
                switch (it.kind) {
                  case "dictation":
                    return (
                      <DictationPost
                        key={`d${it.entry.id}`}
                        entry={it.entry}
                        when={w}
                        icon={
                          (it.entry.app_name && icons[it.entry.app_name]) ||
                          undefined
                        }
                      />
                    );
                  case "learned":
                    return (
                      <ElchiPost
                        key={`l${it.word.word}`}
                        when={w}
                        accent="coral"
                        title={
                          it.word.phrase && it.word.heard?.length
                            ? t("home.learnedPhraseTitle", {
                                heard: it.word.heard[0],
                                word: it.word.word,
                              })
                            : t("home.learnedTitle", { word: it.word.word })
                        }
                        body={
                          it.word.phrase
                            ? t("home.learnedPhraseBody")
                            : it.word.heard?.length
                              ? t("home.learnedHeard", {
                                  heard: it.word.heard[0],
                                })
                              : t("home.learnedAdded")
                        }
                      />
                    );
                  case "streak":
                    return (
                      <ElchiPost
                        key="streak"
                        when={w}
                        title={t("home.streakTitle", { count: it.days })}
                        body={t("home.streakBody", { count: it.days })}
                      />
                    );
                  case "milestone":
                    return (
                      <ElchiPost
                        key={`m${it.words}`}
                        when={w}
                        title={t("home.milestoneTitle", { n: n(it.words) })}
                        body={t("home.milestoneBody", {
                          n: n(it.words),
                          time: minutes(it.words / (stats?.typing_wpm ?? 40)),
                        })}
                      />
                    );
                }
              })}
            </section>
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => onOpenSettings("history")}
              className="mt-5 text-sm font-semibold text-logo-primary hover:underline"
            >
              {t("home.more")} →
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

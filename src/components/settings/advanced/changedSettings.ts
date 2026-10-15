import { useCallback, useMemo } from "react";
import type { AppSettings } from "@/bindings";
import { useSettingsStore } from "../../../stores/settingsStore";

/**
 * The settings shown in Gelişmiş's common tier that can be compared with
 * (and reset to) the backend defaults. Model unload is left out: it is saved
 * through its own command, not the store's reset path.
 */
export const ADVANCED_TRACKED_KEYS = [
  "autostart_enabled",
  "start_hidden",
  "show_tray_icon",
  "overlay_style",
  "overlay_position",
  "history_limit",
  "recording_retention_period",
] as const satisfies readonly (keyof AppSettings)[];

type TrackedKey = (typeof ADVANCED_TRACKED_KEYS)[number];

/**
 * Settings the bulk reset leaves alone: setting them runs history cleanup,
 * which deletes unsaved transcripts and their recordings (the history limit
 * default is 5). They still get the changed mark; the user changes them on
 * their own rows, where the choice is explicit.
 */
const KEEPS_DATA: ReadonlySet<TrackedKey> = new Set([
  "history_limit",
  "recording_retention_period",
]);

/**
 * Which of `keys` differ from `get_default_settings` (platform-specific
 * defaults come from Rust), and a reset for those that can be reset without
 * deleting anything (`resettable`). Empty until the defaults have loaded, so
 * nothing is ever marked changed on a guess.
 */
export const useChangedSettings = (
  keys: readonly TrackedKey[] = ADVANCED_TRACKED_KEYS,
) => {
  const settings = useSettingsStore((s) => s.settings);
  const defaults = useSettingsStore((s) => s.defaultSettings);
  const resetSetting = useSettingsStore((s) => s.resetSetting);

  const changed = useMemo(() => {
    if (!settings || !defaults) return new Set<TrackedKey>();
    return new Set(
      keys.filter(
        (k) =>
          defaults[k] !== undefined &&
          settings[k] !== undefined &&
          settings[k] !== defaults[k],
      ),
    );
  }, [settings, defaults, keys]);

  const resettable = useMemo(
    () => new Set([...changed].filter((k) => !KEEPS_DATA.has(k))),
    [changed],
  );

  const resetAll = useCallback(async () => {
    for (const k of resettable) await resetSetting(k);
  }, [resettable, resetSetting]);

  return { changed, resettable, resetAll };
};

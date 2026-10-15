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
 * Which of `keys` differ from `get_default_settings` (platform-specific
 * defaults come from Rust), plus a reset for all of them. Empty until the
 * defaults have loaded, so nothing is ever marked changed on a guess.
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

  const resetAll = useCallback(async () => {
    for (const k of changed) await resetSetting(k);
  }, [changed, resetSetting]);

  return { changed, resetAll };
};

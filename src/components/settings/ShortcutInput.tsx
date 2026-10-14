import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { SettingContainer } from "../ui/SettingContainer";
import { GlobalShortcutInput } from "./GlobalShortcutInput";
import { HandyKeysShortcutInput } from "./HandyKeysShortcutInput";

interface ShortcutInputProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  shortcutId: string;
  disabled?: boolean;
}

/**
 * Wrapper component that selects the appropriate shortcut input implementation
 * based on the keyboard_implementation setting.
 *
 * - "tauri" (default): Uses GlobalShortcutInput with JS keyboard events
 * - "handy_keys": Uses HandyKeysShortcutInput with backend key events
 */
export const ShortcutInput: React.FC<ShortcutInputProps> = (props) => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const keyboardImplementation = getSetting("keyboard_implementation");
  const externalShortcut = getSetting("external_shortcut");

  // The desktop owns the dictation key (Hyprland binds written by
  // elchi-omarchy-setup): show that key read-only instead of the in-app
  // shortcut, which cannot capture keys on Wayland.
  if (props.shortcutId === "transcribe" && externalShortcut) {
    return (
      <SettingContainer
        title={t("settings.general.shortcut.bindings.transcribe.name")}
        description={t("settings.general.shortcut.external")}
        descriptionMode={props.descriptionMode ?? "tooltip"}
        grouped={props.grouped}
        layout="horizontal"
      >
        <div className="px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded-md">
          {externalShortcut}
        </div>
      </SettingContainer>
    );
  }

  // Default to Tauri implementation if not set
  if (keyboardImplementation === "handy_keys") {
    return <HandyKeysShortcutInput {...props} />;
  }

  return <GlobalShortcutInput {...props} />;
};

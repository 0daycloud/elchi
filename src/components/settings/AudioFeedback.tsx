import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AudioFeedbackProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

// Sound theme names are product names (the debug sound picker uses the same).
const SOUND_NAMES: Record<string, string> = {
  marimba: "Marimba",
  pop: "Pop",
  custom: "Custom",
};

/** Start/stop sounds; while on, the sub line names the sound theme. */
export const AudioFeedback: React.FC<AudioFeedbackProps> = React.memo(
  ({ descriptionMode, grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const audioFeedbackEnabled = getSetting("audio_feedback") || false;
    const soundName = SOUND_NAMES[getSetting("sound_theme") ?? "marimba"];
    const showSoundName =
      audioFeedbackEnabled && !!soundName && !descriptionMode;

    return (
      <ToggleSwitch
        checked={audioFeedbackEnabled}
        onChange={(enabled) => updateSetting("audio_feedback", enabled)}
        isUpdating={isUpdating("audio_feedback")}
        label={t("settings.sound.audioFeedback.label")}
        description={
          showSoundName
            ? soundName
            : t("settings.sound.audioFeedback.description")
        }
        descriptionMode={
          showSoundName ? "inline" : (descriptionMode ?? "tooltip")
        }
        grouped={grouped}
      />
    );
  },
);

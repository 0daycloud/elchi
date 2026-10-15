import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

/** Meetings: keep their audio and full transcript, not only the notes. */
export const MeetingKeepRecording: React.FC<{
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}> = React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  return (
    <ToggleSwitch
      checked={getSetting("meeting_keep_recording") ?? false}
      onChange={(enabled) => updateSetting("meeting_keep_recording", enabled)}
      isUpdating={isUpdating("meeting_keep_recording")}
      label={t("settings.advanced.meetingKeepRecording.label")}
      description={t("settings.advanced.meetingKeepRecording.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      tooltipPosition="bottom"
    />
  );
});

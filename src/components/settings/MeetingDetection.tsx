import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

/** Meetings: offer to take notes when a call starts, and to stop when it ends. */
export const MeetingDetection: React.FC<{
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}> = React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  return (
    <ToggleSwitch
      checked={getSetting("meeting_detection") ?? true}
      onChange={(enabled) => updateSetting("meeting_detection", enabled)}
      isUpdating={isUpdating("meeting_detection")}
      label={t("settings.advanced.meetingDetection.label")}
      description={t("settings.advanced.meetingDetection.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      tooltipPosition="bottom"
    />
  );
});

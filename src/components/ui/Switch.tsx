import React from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there is no visible <label>. */
  "aria-label"?: string;
  /** "onBlue" is the white track used inside the blue Pro zone. */
  tone?: "default" | "onBlue";
  className?: string;
}

/** The 34×19 steel switch: blue track with a light-steel knob. */
export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  tone = "default",
  className = "",
  ...aria
}) => {
  const track =
    tone === "onBlue"
      ? checked
        ? "bg-white"
        : "bg-white/30"
      : checked
        ? "bg-accent"
        : "bg-[var(--toggle-off)]";
  const knob =
    tone === "onBlue" && checked ? "bg-accent" : "bg-[image:var(--knob-bg)]";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-block shrink-0 w-[34px] h-[19px] rounded-full transition-colors shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${track} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] start-[2px] w-[15px] h-[15px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-transform ${knob} ${
          checked ? "translate-x-[15px] rtl:-translate-x-[15px]" : ""
        }`}
      />
    </button>
  );
};

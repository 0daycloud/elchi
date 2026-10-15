import React from "react";

interface SettingsGroupProps {
  title?: string;
  /** Short mono note on the right of the title, e.g. "MacBook Pro mic". */
  hint?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}

/** A titled panel of setting rows separated by hairlines. */
export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  hint,
  description,
  children,
}) => {
  return (
    <section className="space-y-2.5">
      {(title || hint) && (
        <div className="flex items-baseline justify-between gap-4 px-0.5">
          {title && <h2 className="label-mono tracking-[0.12em]">{title}</h2>}
          {hint && <span className="label-mono truncate">{hint}</span>}
        </div>
      )}
      {description && (
        <p className="px-0.5 text-xs text-mid-gray -mt-1">{description}</p>
      )}
      <div className="panel overflow-visible">
        <div className="divide-y divide-[var(--hairline)]">{children}</div>
      </div>
    </section>
  );
};

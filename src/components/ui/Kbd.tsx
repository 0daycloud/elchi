import React from "react";

interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

/** A steel keycap: "⌥", "SPACE", "ESC". Mono, uppercase. */
export const Kbd: React.FC<KbdProps> = ({ children, className = "" }) => (
  <kbd
    className={`steel-chip inline-flex items-center justify-center gap-1.5 min-w-[26px] px-2 py-[3px] rounded-[5px] font-mono text-[10.5px] leading-[1.4] tracking-[0.04em] uppercase ${className}`}
  >
    {children}
  </kbd>
);

/** A row of keycaps, optionally joined by "+". */
export const KbdCombo: React.FC<{
  keys: string[];
  joiner?: boolean;
  className?: string;
}> = ({ keys, joiner = false, className = "" }) => (
  <span className={`inline-flex items-center gap-1.5 ${className}`}>
    {keys.map((k, i) => (
      <React.Fragment key={`${k}-${i}`}>
        {joiner && i > 0 && (
          <span
            aria-hidden="true"
            className="font-mono text-[11px] text-mid-gray"
          >
            +
          </span>
        )}
        <Kbd>{k}</Kbd>
      </React.Fragment>
    ))}
  </span>
);

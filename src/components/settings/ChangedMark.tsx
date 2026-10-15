import React from "react";

/** Puts the small blue "changed from default" dot after a row's title. */
export const ChangedMark: React.FC<{
  on: boolean;
  children: React.ReactNode;
}> = ({ on, children }) => (
  <div
    className={
      on
        ? "[&_h3]:after:content-[''] [&_h3]:after:inline-block [&_h3]:after:size-[5px] [&_h3]:after:rounded-full [&_h3]:after:bg-logo-primary [&_h3]:after:ms-2.5 [&_h3]:after:align-middle"
        : undefined
    }
  >
    {children}
  </div>
);

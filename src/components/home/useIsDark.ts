import { useEffect, useState } from "react";

const query = "(prefers-color-scheme: dark)";

const read = () => {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return window.matchMedia?.(query).matches ?? false;
};

/** Whether the dark palette is showing: the `theme` setting (`data-theme` on
 *  <html>) when it forces one, the OS otherwise. For the few places where
 *  the two themes differ in more than colour (the home hero). */
export const useIsDark = () => {
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const update = () => setDark(read());
    const mq = window.matchMedia?.(query);
    mq?.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      mq?.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return dark;
};

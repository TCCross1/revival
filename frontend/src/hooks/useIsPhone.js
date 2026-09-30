import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/**
 * True for phone-sized viewports (iPhone / small Android).
 * Used to switch Layout into the bottom-tab phone shell.
 */
export default function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsPhone(mql.matches);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return isPhone;
}

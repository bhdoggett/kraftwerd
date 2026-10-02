import { useEffect, useState } from "react";

type ThemeChoice = "light" | "dark" | "system";

const KEY = "kraftwerd:theme";
export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "system"];

function stored(): ThemeChoice {
  const saved = window.localStorage.getItem(KEY);
  return THEME_CHOICES.includes(saved as ThemeChoice) ? (saved as ThemeChoice) : "system";
}

/**
 * Light, dark, or whatever the system says.
 *
 * "system" is resolved here to light or dark, and followed live: the page
 * listens for the OS changing its mind, so nothing freezes at whatever it was
 * on load. Resolving it means the stylesheet only has to know one way of
 * being dark -- the attribute -- rather than writing every dark token out a
 * second time under prefers-color-scheme. index.html sets the same attribute
 * before the first paint, so a dark system never flashes light.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored);

  useEffect(() => {
    const root = document.documentElement;
    window.localStorage.setItem(KEY, choice);

    if (choice !== "system") {
      root.setAttribute("data-theme", choice);
      return;
    }

    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => root.setAttribute("data-theme", dark.matches ? "dark" : "light");
    follow();
    dark.addEventListener("change", follow);
    return () => dark.removeEventListener("change", follow);
  }, [choice]);

  return [choice, setChoice];
}

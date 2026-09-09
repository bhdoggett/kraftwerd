import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "kraftwerd:theme";
export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "system"];

function stored(): ThemeChoice {
  const saved = window.localStorage.getItem(KEY);
  return THEME_CHOICES.includes(saved as ThemeChoice) ? (saved as ThemeChoice) : "system";
}

/**
 * Light, dark, or whatever the system says.
 *
 * "system" removes the attribute rather than resolving it, so the stylesheet's
 * prefers-color-scheme rules apply and the page follows the OS live — a
 * resolved value would freeze at whatever it was when the page loaded.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);

    window.localStorage.setItem(KEY, choice);
  }, [choice]);

  return [choice, setChoice];
}

import { useEffect, useState, type ComponentType } from "react";
import { MoonIcon, SunIcon, SystemIcon } from "./Icons";
import styles from "./Theme.module.css";

type Choice = "light" | "dark" | "system";

const KEY = "kraftwerd:theme";
const CHOICES: Choice[] = ["light", "dark", "system"];
const ICON: Record<Choice, ComponentType> = {
  light: SunIcon,
  dark: MoonIcon,
  system: SystemIcon,
};

function stored(): Choice {
  const saved = window.localStorage.getItem(KEY);
  return CHOICES.includes(saved as Choice) ? (saved as Choice) : "system";
}

/**
 * Light, dark, or whatever the system says.
 *
 * "system" removes the attribute rather than resolving it, so the stylesheet's
 * prefers-color-scheme rules apply and the page follows the OS live — a
 * resolved value would freeze at whatever it was when the page loaded.
 */
export function Theme() {
  const [choice, setChoice] = useState<Choice>(stored);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);

    window.localStorage.setItem(KEY, choice);
  }, [choice]);

  const next = () => CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length]!;
  const Icon = ICON[choice];

  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => setChoice(next())}
      aria-label={`Theme: ${choice}. Switch to ${next()}.`}
      title={`Theme: ${choice}`}
    >
      <Icon />
    </button>
  );
}

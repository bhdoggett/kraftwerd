import type { ReactNode } from "react";
import styles from "./SrOnly.module.css";

/** Text for screen readers only: it takes no space on screen. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className={styles.srOnly}>{children}</span>;
}

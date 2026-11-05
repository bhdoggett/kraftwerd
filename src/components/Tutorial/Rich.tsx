import { Fragment, type ReactNode } from "react";
import { DoubleWordIcon, QuadWordIcon, TripleWordIcon } from "../Icons/Icons";
import styles from "./Tutorial.module.css";

const MARKS: Record<string, () => ReactNode> = {
  "2": () => <DoubleWordIcon size={14} />,
  "3": () => <TripleWordIcon size={14} />,
  "4": () => <QuadWordIcon size={14} />,
};

/**
 * A hint's line with its markup drawn (see `plain` in tutorial/coach.ts):
 * `**word**` bold, `[x3]` the board's own ×3 mark beside the words "×3".
 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[x\d\])/g).filter((p) => p !== "");
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        const mark = /^\[x(\d)\]$/.exec(part);
        if (mark !== null && MARKS[mark[1]] !== undefined) {
          return (
            <span key={i} className={styles.mark}>
              <span className={styles.markIcon} aria-hidden="true">
                {MARKS[mark[1]]()}
              </span>
              ×{mark[1]}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

import styles from "./Board.module.css";

/**
 * Every seat colour at every stack depth, at /swatches.
 *
 * Drawn with the board's own classes, so the colours are the ones the browser
 * really computes — a mock-up recreates `color-mix` by hand and is wrong the
 * moment a token moves. It follows the theme too, which a screenshot cannot.
 */
export function Swatches() {
  const depths = [1, 2, 3];

  return (
    <div style={{ padding: 24, display: "grid", gap: 24 }}>
      {[0, 1, 2, 3].map((seat) => (
        <div key={seat} style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 90, fontFamily: "monospace", fontSize: 13 }}>seat {seat}</span>
          <div className={styles.grid} style={{ gridTemplateColumns: "repeat(3, 44px)" }}>
            {depths.map((depth) => (
              <button
                key={depth}
                type="button"
                className={[styles.cell, styles.tile, depth >= 2 ? styles.stacked : ""].join(" ")}
                data-seat={seat}
                data-stack={depth >= 2 ? depth : undefined}
                style={{ ["--cell-size" as string]: "44px" }}
              >
                <span className={styles.glyph}>{"KRAF"[seat]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

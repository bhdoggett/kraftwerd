import styles from "./Board.module.css";
import own from "./Swatches.module.css";

/**
 * Every tile the board can draw, in both themes at once, at /swatches.
 *
 * Built from the board's own classes, so the colours are the ones the browser
 * really computes: a mock-up recreates color-mix by hand and is wrong the
 * moment a token moves. Each half sets data-theme for itself, which is how
 * both can be seen together — the page cannot be in two themes, but two
 * elements inside it can.
 */
const SEATS = [0, 1, 2, 3];
const LETTERS = "KRAF";

function Row({ seat }: { seat: number }) {
  const cell = (extra: Record<string, string | undefined>, letter: string) => (
    <button
      type="button"
      className={[styles.cell, styles.tile].join(" ")}
      data-seat={seat}
      {...extra}
      style={{ ["--cell-size" as string]: "42px" }}
    >
      <span className={styles.glyph}>{letter}</span>
    </button>
  );

  return (
    <div className={own.row}>
      <span className={own.label}>seat {seat}</span>
      <div className={styles.grid} style={{ gridTemplateColumns: "repeat(3, 42px)" }}>
        {cell({}, LETTERS[seat]!)}
        {cell({ "data-stack": "2" }, LETTERS[seat]!)}
        {cell({ "data-face": "blank" }, "")}
      </div>
    </div>
  );
}

function Half({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={own.half} data-theme={theme}>
      <h2 className={own.heading}>{theme}</h2>
      <div className={own.columns}>
        <span>played</span>
        <span>full</span>
        <span>blank, unnamed</span>
      </div>
      {SEATS.map((seat) => (
        <Row key={seat} seat={seat} />
      ))}
      <p className={own.note}>
        A full square goes back to bare board and lights its letter in the
        colour of whoever played it — ink on paper here, the tube itself on
        black. A blank is white only while it is waiting to be told its
        letter; once it has one it scores and looks like any other tile.
      </p>
    </div>
  );
}

export function Swatches() {
  return (
    <div className={own.page}>
      <Half theme="light" />
      <Half theme="dark" />
    </div>
  );
}

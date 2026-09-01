import board from "./Board.module.css";
import styles from "./MiniBoard.module.css";

interface MiniBoardProps {
  /** One string per row. A dot is an empty square, anything else is a tile. */
  rows: readonly string[];
  /** Whose colour the tiles already on the board wear. */
  seat?: number;
  /** Squares laid this turn, as "x,y" — shown in a second player's colour. */
  played?: readonly string[];
  /**
   * Whose tile each square is, as "x,y" to a seat number. For a position from
   * a real game, where the colours are the players rather than "mine" and
   * "theirs"; anything not named here falls back to `seat`.
   */
  seats?: Readonly<Record<string, number>>;
  /** Squares with a tile on a tile: full, and lit rather than faced. */
  full?: readonly string[];
  /** Squares to ring, for pointing at the thing being explained. */
  ring?: readonly string[];
  size?: number;
  /** What the diagram is showing, read out with it. */
  caption?: string;
}

/**
 * A board position, drawn rather than photographed.
 *
 * Built from the board's own stylesheet, like the swatch page: a screenshot
 * goes stale the moment a colour moves, and would need two of everything to
 * follow the theme. This follows by construction, and costs no image to load.
 *
 * Presentational only — nothing here is clickable, and it holds no state.
 */
export function MiniBoard({
  rows,
  seat = 1,
  played = [],
  seats,
  full = [],
  ring = [],
  size = 28,
  caption,
}: MiniBoardProps) {
  const grid = (
    <div
      className={[board.grid, styles.grid].join(" ")}
      style={{
        gridTemplateColumns: `repeat(${rows[0]?.length ?? 0}, ${size}px)`,
        ["--cell-size" as string]: `${size}px`,
        ["--tile-stroke" as string]: `${Math.max(2, Math.round(size * 0.083))}px`,
      }}
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((letter, x) => {
          const at = `${x},${y}`;
          const empty = letter === ".";
          const isFull = full.includes(at);

          return (
            <div
              key={at}
              className={[
                board.cell,
                empty ? "" : board.tile,
                ring.includes(at) ? styles.ring : "",
              ].join(" ")}
              data-seat={seats?.[at] ?? (played.includes(at) ? 2 : seat)}
              {...(isFull ? { "data-stack": "2" } : {})}
            >
              {!empty && <span className={board.glyph}>{letter}</span>}
            </div>
          );
        }),
      )}
    </div>
  );

  if (caption === undefined) return grid;
  return (
    <figure className={styles.figure}>
      {grid}
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}

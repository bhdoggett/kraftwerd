import type { ReactNode } from "react";
import { LONG_WORD_BONUS } from "../../../shared/config";
import type { Fault, validateTurn } from "../../../shared/engine/legality";
import type { TurnScore } from "../../../shared/engine/score";
import { squareBreakdown } from "../../lib/breakdown";
import styles from "./Game.module.css";

export type Legality = ReturnType<typeof validateTurn>;

/**
 * The square bonus, split by size. The arithmetic lives in
 * `src/lib/breakdown.ts`, where it can be tested: it was computing a block's
 * worth as `size * size` long after squares went flat, so this table showed
 * 9 for a 3x3 the turn's own total had paid 33 for.
 */
const breakdownOf = (score: TurnScore) => squareBreakdown(score.squares);

/** One thing wrong with a staged play, in words a player can act on. */
function describeFault(legality: Fault): string {
  switch (legality.reason) {
    case "empty-turn":
      return "Place at least one tile.";
    case "out-of-bounds":
      return "That square is off the board.";
    case "duplicate-cell":
      return "Two tiles on the same square.";
    case "stack-full":
      return "That square is full -- no more tiles may land there.";
    case "blocked":
      return "That square cannot be played on.";
    case "missing-centre":
      return "The first word has to cover the centre square.";
    case "disconnected":
      return "Every tile must connect to the tiles already on the board.";
    case "unchanged":
      return "A tile laid on another has to change the letter underneath it.";
    case "erased":
      return legality.words.length === 1
        ? `${legality.words[0]} was already on the board and would be covered completely. A word already played has to keep at least one of its letters.`
        : `${legality.words.join(", ")} were already on the board and would be covered completely. A word already played has to keep at least one of its letters.`;
    case "invalid-words":
      return legality.words.length === 1
        ? `${legality.words[0]} is not a word.`
        : `Not words: ${legality.words.join(", ")}.`;
  }
}

/**
 * What this play scores. A play that is not legal scores nothing, whatever
 * its words and squares would have added up to. Drawn in the play panel, and
 * over the board on a small screen, where the panel is a scroll away.
 */
export function ScoreBadge({ score, legality }: { score: TurnScore; legality: Legality | null }) {
  return (
    <span
      className={[
        styles.previewScore,
        legality?.ok === true ? "" : styles.previewNothing,
        legality !== null && !legality.ok ? styles.previewInvalid : "",
      ].join(" ")}
    >
      {legality?.ok === true ? score.total : 0}
    </span>
  );
}

interface PlayPanelProps {
  /** What the play scores, or null while there is nothing to score yet. */
  score: TurnScore | null;
  /** Each word's verdict, once it is back. */
  checked: readonly { word: string; valid: boolean }[] | undefined;
  legality: Legality | null;
  /** 3x3s this play leaves one tile short. */
  leftOpen: number;
  /** The badge for the score line: the same element the board's corner shows. */
  scoreBadge: ReactNode;
}

/**
 * The play in progress: what it spells, what each word and square is worth,
 * and what it scores or why it cannot be played. The game screen shows it
 * while a play is staged; the tutorial also shows it for each recorded move.
 */
export function PlayPanel({ score, checked, legality, leftOpen, scoreBadge }: PlayPanelProps) {
  return (
    <section className={styles.play}>
      <div className={styles.words}>
        {/* Every occurrence, not every distinct word: a letter at a
            crossing belongs to two words and is paid for in each, so
            showing AT once when it was formed twice would make the
            chips fail to add up to the total. */}
        {(score?.words ?? []).map((scored, i) => {
          const valid = checked?.find((e) => e.word === scored.word)?.valid;
          // A real word the play cannot make — unreachable, or burying
          // something — is marked wrong without the line through it.
          // The line means "not a word", and this one is a word.
          const unplayable = valid === true && legality !== null && !legality.ok;
          return (
            <span
              key={`${scored.word}-${i}`}
              className={[
                styles.word,
                valid === undefined
                  ? styles.checking
                  : unplayable
                    ? styles.blockedWord
                    : valid
                      ? styles.valid
                      : styles.invalid,
                // Only once it counts: a chip still being checked, or one
                // that turns out not to be a word, has nothing doubled.
                scored.bonus !== undefined && valid === true && !unplayable ? styles.doubled : "",
              ].join(" ")}
            >
              {scored.word}
              {/* The multiplier the square applied, said rather than
                  left to be inferred from a number that looks too big.
                  x4 when the play crossed two of them. */}
              {scored.bonus !== undefined && valid === true && !unplayable && (
                <span className={styles.doubleMark}>×{scored.bonus}</span>
              )}
              {/* The long-word bonus is flat and turn-wide (see the
                  summary line below), not baked into this word's own
                  points -- so it gets the same kind of said-not-inferred
                  badge the multiplier does, just with a plus instead of
                  a times, on whichever word actually reached the length
                  that earned it. */}
              {scored.long && valid === true && !unplayable && (
                <span className={styles.longMark}>+{LONG_WORD_BONUS}</span>
              )}
              {/* While the verdict is out the points hold their space, so
                  the chip does not resize when it lands. Once the answer
                  is in and the word scores nothing, the space goes: it
                  cannot change again, and an empty gap reads as a bug. */}
              {valid === undefined ? (
                <span className={[styles.wordPoints, styles.pointsHidden].join(" ")}>{scored.points}</span>
              ) : (
                valid && !unplayable && <span className={styles.wordPoints}>{scored.points}</span>
              )}
            </span>
          );
        })}
      </div>

      {score && breakdownOf(score).length > 0 && (
        <div className={styles.bonus}>
          <h3 className={styles.bonusHeading}>Square bonus</h3>
          <table className={styles.breakdown}>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">Number</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {breakdownOf(score).map((line) => (
                <tr key={line.size}>
                  <td>
                    <span className={styles.size}>{line.size}</span>
                  </td>
                  <td>{line.count}</td>
                  <td className={styles.rowTotal}>{line.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {score && score.longWordBonus > 0 && (
        <p className={styles.scoreLine}>
          Long words: <span className={styles.previewScore}>+{score.longWordBonus}</span>
        </p>
      )}

      {/*
        One slot for the verdict: what the play scores, or -- when it
        cannot be played -- why not, one line per kind of fault, since a
        play can be disconnected and not a word at once. Never both: a
        play that is wrong scores 0, which the badge on the board already
        says. A separate line held open for the reasons left a blank gap
        under every good play, and the panel has to keep its height
        rather than grow a line when a fault appears -- on a phone that
        is what made the board jump. One slot does both.
      */}
      {legality !== null && !legality.ok ? (
        <div className={styles.reasons}>
          {legality.faults.map((fault) => (
            <p key={fault.reason} className={styles.reason}>
              {describeFault(fault)}
            </p>
          ))}
        </div>
      ) : (
        score && <p className={styles.scoreLine}>This play scores {scoreBadge}</p>
      )}

      {leftOpen > 0 && <p className={styles.warning}>Leaves a 3×3 one tile short for the next player.</p>}
    </section>
  );
}

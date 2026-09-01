import { applyPlacements, validateTurn } from "../engine/legality.js";
import type { Dictionary } from "../engine/legality.js";
import type { Board } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { components, moveKey, type Hand, type Move, type ValueFn } from "./components.js";

/** What is left of a hand after a set of tiles is laid. */
function spend(hand: Hand, placements: readonly Placement[]): Hand {
  const letters = [...hand.letters];
  let blanks = hand.blanks;

  for (const p of placements) {
    if (p.isBlank) {
      blanks--;
      continue;
    }
    const at = letters.indexOf(p.letter);
    if (at >= 0) letters.splice(at, 1);
  }

  return { letters, blanks };
}

/**
 * Turns made of more than one play.
 *
 * The rules never asked for a turn to be one word on one line -- that was
 * only ever what the search could see. A turn is any set of placements whose
 * runs all spell something and which leaves the board one connected mass, so
 * a word here and a tile there is a single move, and the two together can
 * close a square that neither would have.
 *
 * Built by recursion: take a component, lay it on a provisional board, search
 * again with what is left of the rack. Each step is a legal play in its own
 * right, which is what keeps the search affordable -- an illegal intermediate
 * cannot be pruned on, and the branching would not survive it.
 *
 * But a run of legal steps is not a legal turn, so the accumulated placements
 * are checked whole against the board the turn began on before any of them are
 * offered. Legality does not simply compose, and the way it fails is easy to
 * miss: a later link is free to lay a tile on top of one an earlier link put
 * down, because on the provisional board that is an ordinary stacking play --
 * but as a turn it is two tiles claiming one square, which is `duplicate-cell`
 * and not a move at all. Covering a whole existing word between them, which
 * neither link does alone, goes the same way. A failure is not merely dropped
 * but pruned: every deeper chain through it inherits the same fault, since the
 * placements only accumulate.
 *
 * The whole accumulated turn is scored once, at the end, against the board the
 * turn began on. Scoring each step against the one before it would miss the
 * point: two components that separately complete nothing can together complete
 * a 2x2, and square bonuses do not add up, they compound.
 */
export function chain(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: { depth: number; breadth: number; maxLength?: number },
): Move[] {
  const found: Move[] = [];
  const seen = new Set<string>();

  /*
   * No `connected: true` here. A chained turn is a union of several spans, and
   * the reasoning that lets the single-span search skip the connectivity walk
   * -- one unbroken line, touching the mass -- says nothing about a union of
   * them. The walk is what proves this turn leaves one mass, so it is run.
   */
  const bounds = {
    width: size,
    height: size,
    blocked: shape.blocked,
    centre: shape.centre,
  };

  const emit = (placements: Placement[]) => {
    const key = moveKey(placements);
    if (seen.has(key)) return;
    seen.add(key);

    const after = applyPlacements(board, placements);
    const score = scoreOf(after, placements, board);
    found.push({ placements, score, value: score });
  };

  const walk = (provisional: Board, left: Hand, laid: Placement[], depth: number) => {
    if (left.letters.length + left.blanks === 0) return;

    const step = components(provisional, left, dictionary, words, shape, size, scoreOf, {
      maxLength: options.maxLength,
      before: provisional,
    });

    for (const component of step.slice(0, options.breadth)) {
      const placements = [...laid, ...component.placements];
      if (!validateTurn(board, placements, dictionary, bounds).ok) continue;

      emit(placements);

      if (depth > 1) {
        walk(
          applyPlacements(provisional, component.placements),
          spend(left, component.placements),
          placements,
          depth - 1,
        );
      }
    }
  };

  walk(board, hand, [], options.depth);
  found.sort((a, b) => b.value - a.value);
  return found;
}

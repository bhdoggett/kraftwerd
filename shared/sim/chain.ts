import { applyPlacements, validateTurn } from "../engine/legality.js";
import type { Dictionary } from "../engine/legality.js";
import type { Board } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { components, moveKey, type Hand, type Move, type ValueFn } from "./components.js";
import { exposure } from "./judgement.js";

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
  options: {
    depth: number;
    breadth: number;
    maxLength?: number;
    blanks?: boolean;
    /**
     * Order candidates by what they leave for the NEXT link, not by their own
     * score. The number is how much a point of `exposure` is worth against a
     * point of turn score; absent, branching is by score alone, which is what
     * every figure in design.md section 6 was measured at.
     *
     * `exposure` is the opponent-facing penalty, reused here with its sign
     * flipped -- see the note on it in judgement.ts. It counts blocks left one
     * tile short, which is a gift to whoever moves next; part-way through a
     * chain, whoever moves next is this same player.
     *
     * It exists because branching by score cannot find what chaining is for.
     * A component's own score is points collected now; the whole point of a
     * second link is a square that neither link completes alone, and the setup
     * play that makes one possible scores badly on its own. So the top of a
     * score-sorted list is long words that consume the rack, and the cheap tile
     * that leaves a letter to cross is far down it -- which is why depth 3 buys
     * nothing until breadth is wide enough to reach that far by brute force.
     */
    enablement?: number;
  },
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

  /** Offer a turn, once, however many orders of play arrive at it. */
  const offer = (placements: Placement[], score: number) => {
    const key = moveKey(placements);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ placements, score, value: score });
  };

  const walk = (provisional: Board, left: Hand, laid: Placement[], depth: number) => {
    if (left.letters.length + left.blanks === 0) return;

    const step = components(provisional, left, dictionary, words, shape, size, scoreOf, {
      maxLength: options.maxLength,
      before: provisional,
      blanks: options.blanks,
    });

    /*
     * The opening link is the single-span search itself, already validated and
     * scored against this very board, so it is taken as it stands.
     *
     * All of it, not just the few links worth building on. `breadth` limits
     * what is branched from, never what is offered: this list is what
     * difficulty reads, and its bands are fractions of the best score, so
     * cutting it back to the strongest handful and their extensions leaves an
     * easy player nothing weak left to choose.
     */
    if (laid.length === 0) for (const single of step) offer(single.placements, single.score);

    for (const component of branchesOf(step, provisional, depth)) {
      const placements = [...laid, ...component.placements];

      if (laid.length > 0) {
        if (!validateTurn(board, placements, dictionary, bounds).ok) continue;
        offer(placements, scoreOf(applyPlacements(board, placements), placements, board));
      }

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

  /**
   * The candidates worth building on, best `breadth` first.
   *
   * `depth` here is what is LEFT, so `depth <= 1` is the last link -- nothing
   * follows it, so there is nothing for it to enable, and what it leaves is a
   * gift rather than a setup. Ordering by enablement there would be pointing
   * the sign the wrong way, so it falls back to score.
   *
   * Sorts a copy. `step` is what the caller above offers to the difficulty
   * sampler when this is the first link, and re-ordering that list in place
   * would be reaching outside what this function is for.
   */
  const branchesOf = (step: readonly Move[], provisional: Board, depth: number) => {
    const w = options.enablement;
    if (w === undefined || depth <= 1) return step.slice(0, options.breadth);

    return [...step]
      .map((c) => ({
        c,
        key: c.score + w * exposure(provisional, c.placements, shape, size),
      }))
      .sort((a, b) => b.key - a.key)
      .slice(0, options.breadth)
      .map((x) => x.c);
  };

  walk(board, hand, [], options.depth);
  found.sort((a, b) => b.value - a.value);
  return found;
}

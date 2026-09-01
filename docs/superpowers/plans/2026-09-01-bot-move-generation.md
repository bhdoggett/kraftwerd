# Bot Move Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bot the full legal move space — chained plays, deliberate
k x k squares, priced blanks — and select from it by score-fraction difficulty
bands.

**Architecture:** Three generation stages feed one ranked list. Stage 1 is
today's span search, made anchor-first so it is cheap enough to call
repeatedly. Stage 2 chains it recursively (apply a component to a provisional
board, re-search with the remaining rack), accumulating placements and scoring
once at the end. Stage 3 is a targeted constraint solver for k x k blocks,
reaching turns that are only legal as a whole. Judgment (exposure penalty,
blank reserve price) and selection (difficulty bands) sit on top and are
agnostic to which stage produced a move.

**Tech Stack:** TypeScript, Vitest (`engine` project, node environment),
Convex (`convex/bots.ts` runs the live bot inside a mutation),
`node:worker_threads` for the simulator.

**Spec:** `docs/superpowers/specs/2026-09-01-bot-move-generation-design.md`

## Global Constraints

- **TypeScript only.** No plain JavaScript. (`scripts/*.mjs` are pre-existing
  build scripts; new script code is `.ts`, run via `npx tsx`.)
- **`STACK_CAP = 2`** (`shared/config.ts`). A square holds at most this many
  tiles over its lifetime.
- **`BLANKS_PER_GAME = 3`**, **`GAME.endThreshold = 50`**,
  **`GAME.boardSize = 15`**, **`RACK.size = 7`** (`shared/config.ts`).
- **Never hardcode "blanks go on empty cells only."** Prune on the real
  predicate from `legality.ts`:
  `p.isBlank && priorStack + 1 >= STACK_CAP && priorStack > 0`. At
  `STACK_CAP = 2` it happens to mean blanks-on-empty; at 3 it would not.
- **Words considered are length 2..7.** `convex/bots.ts` builds the index with
  `indexWords(ALL_WORDS.filter(w => w.length <= 7), 7)`. Crossing words are
  validated against the full dictionary, not the index.
- **`scoreTurn` must always be called with `{ before }`** set to the board at
  the *start of the turn*. Chained placements score once, together, against
  that board — never incrementally.
- **The simulator's "identical draws across variants" guarantee is
  load-bearing.** Every variant must see the same bags. Seeds key on game
  index (`seeded(i + 1)`); keep it that way.
- Run tests with `npx vitest run --project engine`. Full suite:
  `npm test`. Typecheck: `npm run typecheck`.
- **`npm run lint` is red at baseline and is not a gate.** It reports 58
  errors on an untouched tree (mostly `no-unnecessary-type-assertion` in
  `src/`, plus a parser error on `vitest.config.ts`). Fixing them is not this
  plan's job. Instead, check that you have not made it worse in the code you
  touched:

  ```bash
  ./node_modules/.bin/eslint shared convex scripts | tail -2
  ```

  That reports **43 problems** at this plan's baseline (commit `69a0c19`).
  Your task must leave it at 43 or fewer. A verbatim move of code carrying an
  error keeps the count the same — that is correct, not a regression.

---

## File Structure

`shared/sim/bot.ts` is 545 lines and this work would roughly double it, so it
splits by responsibility. Each new file has one job:

- **Create `shared/sim/words.ts`** — the dictionary index. `LengthIndex`,
  `WordIndex`, `indexWords`, `rackWords`, `candidates`, `withOneCovered`,
  `maskOf`, `bit`. Moved verbatim from `bot.ts`.
- **Create `shared/sim/components.ts`** — stage 1. Anchor and span
  enumeration, `fit`, `components()`. The single-word-on-one-span search.
- **Create `shared/sim/chain.ts`** — stage 2. Recursive composition of
  components.
- **Create `shared/sim/blocks.ts`** — stage 3. The k x k constraint solver.
- **Create `shared/sim/judgement.ts`** — exposure penalty, blank reserve
  price, and the assembly of `value` from `score`.
- **Modify `shared/sim/bot.ts`** — orchestration only: `Move`, `MoveOptions`,
  `rank`, `bestMove`, `chooseRanked`, plus re-exports so existing importers
  (`convex/bots.ts`, `shared/sim/game.ts`, `scripts/simulate.ts`) keep working
  unchanged.
- **Create `scripts/sim-worker.ts`** — worker entry point playing one game.
- **Modify `scripts/simulate.ts`** — dispatch games to a worker pool.
- **Modify `docs/design.md`** — correct the stale §4.1 blank-scoring claim.

Test files mirror their subjects: `words.test.ts`, `components.test.ts`,
`chain.test.ts`, `blocks.test.ts`, `judgement.test.ts`, plus
`shared/sim/legality.property.test.ts` for the cross-cutting safety net.
`shared/sim/bot.test.ts` stays as the integration-level test.

**Task order is deliberate.** The anchor speedup (Task 4) comes before
chaining because chaining is unaffordable without it. The property test
(Task 5) comes before the two risky generation stages so the safety net exists
when they land.

---
## Task 1: Extract the word index into its own module

Pure refactor, no behaviour change. Everything after this touches
`bot.ts`, so shrinking it first makes every later task easier to hold in
context.

**Files:**
- Create: `shared/sim/words.ts`
- Create: `shared/sim/words.test.ts`
- Modify: `shared/sim/bot.ts` (remove the moved symbols, add a re-export)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface LengthIndex { words: string[]; masks: Uint32Array; posting: Map<string, number[]>; anagrams: Map<string, number[]> }`
  - `export interface WordIndex { byLength: Map<number, LengthIndex>; has: (word: string) => boolean }`
  - `export function indexWords(words: Iterable<string>, maxLength: number): WordIndex`
  - `export function rackWords(index: LengthIndex, letters: readonly string[], length: number): number[]`
  - `export function candidates(index: LengthIndex, fixed: [number, string][]): number[] | null`
  - `export function withOneCovered(index: LengthIndex, fixed: [number, string][], rackPool: readonly number[]): number[]`
  - `export function bit(letter: string): number`

- [ ] **Step 1: Write the failing test**

Create `shared/sim/words.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { candidates, indexWords, rackWords } from "./words";

describe("the word index", () => {
  const index = indexWords(["CAT", "COT", "CATS", "AT", "TO"], 7);

  test("groups words by length", () => {
    expect(index.byLength.get(3)!.words.sort()).toEqual(["CAT", "COT"]);
    expect(index.byLength.get(4)!.words).toEqual(["CATS"]);
  });

  test("knows every word regardless of length", () => {
    expect(index.has("CATS")).toBe(true);
    expect(index.has("DOG")).toBe(false);
  });

  test("finds words the rack can spell outright", () => {
    const three = index.byLength.get(3)!;
    // Letters must arrive sorted: rackWords skips duplicate subsets by
    // comparing neighbours.
    const found = rackWords(three, ["A", "C", "T"], 3).map((i) => three.words[i]);
    expect(found).toEqual(["CAT"]);
  });

  test("finds words matching letters fixed at positions", () => {
    const three = index.byLength.get(3)!;
    const found = candidates(three, [[0, "C"], [2, "T"]])!.map((i) => three.words[i]);
    expect(found.sort()).toEqual(["CAT", "COT"]);
  });

  test("returns null when nothing is fixed", () => {
    expect(candidates(index.byLength.get(3)!, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/words.test.ts`
Expected: FAIL — `Cannot find module './words'`.

- [ ] **Step 3: Create the module**

Create `shared/sim/words.ts`. Move these symbols out of `shared/sim/bot.ts`
**verbatim**, changing only their visibility: `LengthIndex`, `WordIndex`,
`bit`, `maskOf`, `indexWords`, `rackWords`, `candidates`, `withOneCovered`.

Keep every existing doc comment with its symbol — they explain why the index
is shaped this way and are the reason the search is affordable.

Change visibility: `rackWords`, `candidates`, `withOneCovered` and `bit` were
module-private; export them. `maskOf` stays private.

The file needs no imports from the rest of the codebase — it is pure string
and dictionary work.

- [ ] **Step 4: Rewire `bot.ts`**

Delete the moved symbols from `shared/sim/bot.ts`. Add at the top:

```ts
import {
  candidates,
  indexWords,
  rackWords,
  withOneCovered,
  type LengthIndex,
  type WordIndex,
} from "./words.js";
```

And re-export, so existing importers keep working untouched:

```ts
export { indexWords, type LengthIndex, type WordIndex } from "./words.js";
```

`convex/bots.ts` imports `indexWords` and `WordIndex` from
`shared/sim/bot.js`; `scripts/simulate.ts` imports `indexWords` from
`../shared/sim/bot.ts`. Neither may need editing — the re-export is what
guarantees that.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project engine`
Expected: PASS — the new `words.test.ts` and the whole existing suite,
including `shared/sim/bot.test.ts` unchanged.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Note `.js` extensions in imports — this project uses
them in TypeScript source (see the existing imports in `bot.ts`).

- [ ] **Step 7: Commit**

```bash
git add shared/sim/words.ts shared/sim/words.test.ts shared/sim/bot.ts
git commit -m "refactor(bot): the word index in its own module"
```

---

## Task 2: Split what a move scores from what the bot thinks of it

`Move.score` currently carries both, because `lookahead` subtracts its penalty
straight into it. Once exposure and blank pricing land, the sim would report
penalised scores as if they were points earned.

**Files:**
- Modify: `shared/sim/bot.ts` (the `Move` interface, `rank`, the lookahead block)
- Modify: `shared/sim/bot.test.ts:100` (the one-move fixture literal)

**Interfaces:**
- Consumes: Task 1's `words.ts` exports.
- Produces:
  - `export interface Move { placements: Placement[]; score: number; value: number }`
  - `export type ValueFn = (after: Board, placements: readonly Placement[], before: Board) => number`
  - `rank(...)` returns moves sorted by `value` descending.

**This task also fixes a live bug.** `rank` currently calls
`value(board, laid.placements)` with the **pre-move** board, but `scoreTurn`'s
first argument is the board **after** placement — which is how
`convex/games.ts:660` calls it. So the bot evaluates every move against a
board its tiles are not on. Probed on `CAT` with a rack of `S`:

- `S` at (9,7) — the search says 4, a fresh scoring says 4. Coincidence: a
  three-letter run plus a lone tile happens to equal `CATS`.
- `S` at (7,8) — the search says 1, a fresh scoring says 2. The vertical run
  `AS` is invisible to it.

The bot therefore undervalues extensions and crossing words — the exact
mechanic design.md §4.1 singles out ("one tile added to `RISE` scores `RISEN`
in full"). Displayed scores are unaffected; only the bot's choice of move is.
`bestMove`'s default `(b, p) => scoreTurn(b, p).total` has the same fault.

Passing the after board is what makes `ValueFn` three-argument, so the two
changes are one change.

- [ ] **Step 1: Write the failing test**

Add to `shared/sim/bot.test.ts`, inside the existing top-level `describe("the bot", ...)`:

```ts
test("reports what a move scores separately from what it is worth", () => {
  const moves = rank(
    makeBoard([]),
    { letters: ["C", "A", "T"], blanks: 0 },
    dictionary,
    words,
    shape,
    15,
    (b, p) => scoreTurn(b, p).total,
    {},
  );

  expect(moves.length).toBeGreaterThan(0);
  // With no judgement configured the two agree, and both are real points.
  for (const move of moves) {
    expect(move.value).toBe(move.score);
    expect(move.score).toBeGreaterThan(0);
  }
});

test("lookahead lowers a move's value without touching its score", () => {
  const board = makeBoard([..."CAT"].map((letter, i) => ({
    x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
  })));

  const plain = rank(board, { letters: ["E"], blanks: 0 }, dictionary, words,
    shape, 15, (b, p) => scoreTurn(b, p, { before: board }).total, {});
  const wary = rank(board, { letters: ["E"], blanks: 0 }, dictionary, words,
    shape, 15, (b, p) => scoreTurn(b, p, { before: board }).total,
    { lookahead: { rack: ["A", "E", "T"], weight: 1 } });

  // Same move, same points; only the opinion of it moves.
  const key = (m: Move) => JSON.stringify(m.placements);
  const before = plain.find((m) => key(m) === key(wary[0]!))!;
  expect(wary[0]!.score).toBe(before.score);
  expect(wary[0]!.value).toBeLessThanOrEqual(before.value);
});

test("scores a move against the board its tiles are on", () => {
  const board = makeBoard([..."CAT"].map((letter, i) => ({
    x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
  })));

  const moves = rank(board, { letters: ["S"], blanks: 0 }, dictionary, words,
    shape, 15, (after, p, before) => scoreTurn(after, p, { before }).total, {});

  // Every move must report what a fresh scoring of the same placements gives.
  // The search used to score against the board *before* the move, so a tile
  // forming a crossing word scored as a lone letter.
  for (const move of moves) {
    const after = applyPlacements(board, move.placements);
    expect(move.score).toBe(scoreTurn(after, move.placements, { before: board }).total);
  }
});
```

`applyPlacements` needs importing into the test file from
`../engine/legality`. The `WORDS` list at the top of `bot.test.ts` must
contain `CATS` and a two-letter word starting `A` (e.g. `AS`) for this to
exercise anything — extend it if it does not.

You will need `scoreTurn` imported in the test file — it already is.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/bot.test.ts`
Expected: FAIL — `move.value` is `undefined`.

- [ ] **Step 3: Widen the interface**

In `shared/sim/bot.ts`:

```ts
export interface Move {
  placements: Placement[];
  /** Points the turn actually scores, by the rules. */
  score: number;
  /** score less any penalty — what ranking and difficulty read. */
  value: number;
}
```

- [ ] **Step 4: Set `value` where moves are made**

Rename `rank`'s local `value` parameter to `scoreOf` — it now collides
confusingly with the field — and retype it as `ValueFn`. Then, where moves are
pushed, build the board the move actually makes and score against that:

```ts
const after = applyPlacements(board, laid.placements);
const score = scoreOf(after, laid.placements, board);
found.push({ placements: laid.placements, score, value: score });
```

`applyPlacements` is already imported in `bot.ts`. This copies the board map
once per candidate, which is a real cost on a busy board — Task 4 profiles it
and is where any optimisation belongs. Correctness first: the search has been
choosing moves on wrong numbers.

Fix `bestMove`'s default while you are here:

```ts
const scoreOf = options.value ?? ((after, p, before) => scoreTurn(after, p, { before }).total);
```

and widen `MoveOptions.value` to `ValueFn`.

Change the sort to read `value`:

```ts
found.sort((a, b) => b.value - a.value);
```

In the lookahead block, subtract into `value` and leave `score` alone:

```ts
const looked = found.slice(0, ahead.breadth ?? 6).map((move) => {
  const after = applyPlacements(board, move.placements);
  const reply = search(after, { letters: ahead.rack, blanks: 0 }, dictionary,
    words, shape, size, scoreOf, { maxLength: options.maxLength });

  return { ...move, value: move.value - ahead.weight * (reply?.score ?? 0) };
});

looked.sort((a, b) => b.value - a.value);
```

- [ ] **Step 5: Fix the one-move fixture**

`shared/sim/bot.test.ts` has a `Move` literal that now misses a field:

```ts
const only = [{ placements: [], score: 5, value: 5 }];
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project engine`
Expected: PASS, whole suite.

- [ ] **Step 7: Commit**

```bash
git add shared/sim/bot.ts shared/sim/bot.test.ts
git commit -m "refactor(bot): what a move scores is not what it is worth"
```

---

## Task 3: Choose by score fraction rather than rank

**Files:**
- Modify: `shared/sim/bot.ts` (`TAU` out, `BANDS` in, `chooseRanked` rewritten)
- Modify: `shared/sim/bot.test.ts` (the `describe("choosing by difficulty")` block)

**Interfaces:**
- Consumes: Task 2's `Move.value`.
- Produces: `chooseRanked(moves: readonly Move[], difficulty: Difficulty, rng: () => number): Move | null` — same signature, new semantics. Callers (`convex/bots.ts:inPreferredOrder`) need no change.

**Why the existing tests get replaced, not extended:** they assert positions
in the ranking (`best` proportion, `mean` index), which is exactly the proxy
the spec rejects. Their fixture is 20 moves scoring 100 down to 81 — a 19%
spread, so *every* move sits in hard's band and easy's band is empty. Testing
bands against it would measure the fixture, not the code.

- [ ] **Step 1: Write the failing test**

Replace the whole `describe("choosing by difficulty", ...)` block in
`shared/sim/bot.test.ts` with:

```ts
describe("choosing by difficulty", () => {
  // A realistic spread: 100 down to 5. Bands land cleanly —
  // hard [85,100] = indices 0-3, medium [55,85] = 3-9, easy [30,55] = 9-14.
  const moves: Move[] = Array.from({ length: 20 }, (_, i) => ({
    placements: [],
    score: 100 - i * 5,
    value: 100 - i * 5,
  }));

  const sample = (difficulty: Parameters<typeof chooseRanked>[1], list = moves) => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    const picks = Array.from({ length: 4000 }, () => chooseRanked(list, difficulty, rng)!);
    const best = list[0]!.value;
    return {
      meanFraction: picks.reduce((sum, m) => sum + m.value / best, 0) / picks.length,
      lowestFraction: Math.min(...picks.map((m) => m.value / best)),
      highestFraction: Math.max(...picks.map((m) => m.value / best)),
    };
  };

  test("hard gives up little of what is on offer", () => {
    const { lowestFraction, meanFraction } = sample("hard");

    expect(lowestFraction).toBeGreaterThanOrEqual(0.85);
    expect(meanFraction).toBeGreaterThan(0.9);
  });

  test("easy plays well below the best available", () => {
    const { lowestFraction, highestFraction } = sample("easy");

    expect(highestFraction).toBeLessThanOrEqual(0.55);
    expect(lowestFraction).toBeGreaterThanOrEqual(0.3);
  });

  test("medium sits between them", () => {
    expect(sample("medium").meanFraction).toBeLessThan(sample("hard").meanFraction);
    expect(sample("medium").meanFraction).toBeGreaterThan(sample("easy").meanFraction);
  });

  test("with one move on offer, every difficulty plays it", () => {
    const only = [{ placements: [], score: 5, value: 5 }];

    for (const level of ["easy", "medium", "hard"] as const) {
      expect(chooseRanked(only, level, () => 0.99)).toBe(only[0]);
    }
  });

  test("an empty band widens upward rather than failing to play", () => {
    // Everything is close to the best, so easy's [0.30, 0.55] catches nothing.
    const tight: Move[] = Array.from({ length: 5 }, (_, i) => ({
      placements: [],
      score: 100 - i,
      value: 100 - i,
    }));

    const chosen = chooseRanked(tight, "easy", () => 0.99);
    // The nearest move above the band: the weakest on offer, never null.
    expect(chosen).toBe(tight[4]);
  });

  test("falls back to rank position when nothing scores above zero", () => {
    const bleak: Move[] = Array.from({ length: 10 }, (_, i) => ({
      placements: [],
      score: 5,
      value: -i,
    }));

    // Fractions of a negative best invert the ordering, so position decides.
    // Hard takes from the top of the list; easy from further down.
    expect(bleak.indexOf(chooseRanked(bleak, "hard", () => 0.01)!)).toBeLessThan(3);
    expect(bleak.indexOf(chooseRanked(bleak, "easy", () => 0.01)!)).toBeGreaterThan(3);
  });

  test("never returns null for a non-empty list", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      expect(chooseRanked(moves, level, () => 0.999)).not.toBeNull();
      expect(chooseRanked(moves, level, () => 0)).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/bot.test.ts`
Expected: FAIL — `hard` currently samples the whole list by rank, so
`lowestFraction` drops far below 0.85.

- [ ] **Step 3: Replace `TAU` with `BANDS`**

In `shared/sim/bot.ts`, delete the `TAU` table and its doc comment. Add:

```ts
/**
 * How much of what is on offer a player is willing to give up.
 *
 * Banding by score rather than by rank position, because rank is a weak
 * proxy: in a list of four hundred moves the first and the fortieth may both
 * score 21, and a rank band would call them far apart. A fraction of the best
 * available means what it sounds like — a hard player leaves about a seventh
 * of the points on the table, an easy one over half.
 */
const BANDS: Record<Difficulty, [number, number]> = {
  hard: [0.85, 1.0],
  medium: [0.55, 0.85],
  easy: [0.3, 0.55],
};

/**
 * How sharply a player prefers the top of its band.
 *
 * The band decides how good a move the bot is willing to play; this decides
 * how it picks among the moves it has settled for. One value for every
 * difficulty — the band already carries the difference.
 */
const TAU = 2.5;
```

- [ ] **Step 4: Rewrite `chooseRanked`**

```ts
export function chooseRanked(
  moves: readonly Move[],
  difficulty: Difficulty,
  rng: () => number,
): Move | null {
  if (moves.length === 0) return null;

  const [lo, hi] = BANDS[difficulty];
  const best = moves[0]!.value;
  let band: readonly Move[];

  if (best <= 0) {
    /*
     * Every move is a bad one. Fractions of a non-positive best invert the
     * ordering -- half of -10 is -5, which is better, not worse -- so the
     * band is read as positions down the list instead.
     */
    const from = Math.floor((1 - hi) * moves.length);
    const to = Math.max(from + 1, Math.ceil((1 - lo) * moves.length));
    band = moves.slice(from, to);
  } else {
    band = moves.filter((m) => m.value >= lo * best && m.value <= hi * best);

    /*
     * Nothing in the band: too few moves, or all of them bunched above it.
     * Widen upward to the weakest move that still clears the floor -- the
     * closest thing to what was asked for. Never downward, and never no move
     * at all: a bot with something legal to play has to play it.
     */
    if (band.length === 0) {
      const above = moves.filter((m) => m.value >= lo * best);
      band = above.length > 0 ? [above[above.length - 1]!] : [moves[0]!];
    }
  }

  const weights = band.map((_, i) => Math.exp(-i / TAU));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng() * total;
  for (const [i, weight] of weights.entries()) {
    roll -= weight;
    if (roll < 0) return band[i]!;
  }
  return band[band.length - 1]!;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project engine`
Expected: PASS. `convex/bots.ts` compiles untouched — the signature held.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add shared/sim/bot.ts shared/sim/bot.test.ts
git commit -m "feat(bot): difficulty as a share of the points on offer"
```

---
## Task 4: Make the component search cheap enough to call repeatedly

Chaining calls this search once per recursive step. At today's ~100ms a
depth-2 chain at breadth 6 costs seven searches — 0.7s per bot turn, and the
simulator does ~20 turns a game across thousands of games. **Nothing after
this task is affordable until this one lands.**

**Files:**
- Create: `shared/sim/components.ts`
- Create: `shared/sim/components.test.ts`
- Modify: `shared/sim/bot.ts` (`rank` delegates to `components`)

**Interfaces:**
- Consumes: Task 1's `words.ts`, Task 2's `Move`.
- Produces:
  - **`Move`, `Hand` and `ValueFn` now live here**, re-exported from `bot.ts`.
    `ValueFn` arrives in Task 2; this task is where it comes to rest.
    They cannot stay in `bot.ts`: Task 6's `chain.ts` and Task 7's `blocks.ts`
    both need them, and `bot.ts` imports both of those. Type-only imports
    would erase at runtime, but a values-and-types cycle through `moveKey` is
    a trap waiting for the next edit. Put them at the bottom of the dependency
    graph instead.
  - `export interface Anchor { x: number; y: number }`
  - `export function anchors(board: Board, shape: BoardShape, size: number): Set<string>` — cell keys worth building through: occupied cells and their orthogonal neighbours, or just the centre on an empty board.
  - `export function components(board: Board, hand: Hand, dictionary: Dictionary, words: WordIndex, shape: BoardShape, size: number, scoreOf: ValueFn, options: { maxLength?: number; before?: Board }): Move[]` — every single-span move, sorted by value descending, **deduplicated**. `before` defaults to `board` and is what `scoreOf` measures against; chaining passes the turn's starting board.
  - `export function moveKey(placements: readonly Placement[]): string` — a turn's identity, independent of the order its tiles were found in.
  - `export interface Hand { letters: readonly string[]; blanks: number }` (moved from `bot.ts`, re-exported there)

- [ ] **Step 1: Profile before changing anything**

Do not optimise on my guess. Find out where the 100ms goes:

```bash
npx tsx --cpu-prof --cpu-prof-dir=/tmp/botprof scripts/simulate.ts 3 2
```

Open the `.cpuprofile` in Chrome DevTools (Performance → Load profile).

**The two suspects, in order of my confidence:**

1. **`validateTurn` calls `isOneMass`, which BFS-walks the entire board, for
   every candidate move.** The bot generates thousands of candidates a turn
   and connectivity is the same answer nearly every time. This is O(tiles) per
   candidate when it could be O(1).
2. **Span enumeration reads every span on the board** — `spans(size, length)`
   yields all 2,700 of them across lengths 2–7 — and only then checks
   `touchesLive`. Early and mid game most of the board is nowhere near play.

Record which dominates. If the profile says something else entirely, follow
the profile and adapt the steps below; the budget assertion in Step 6 is the
real requirement.

- [ ] **Step 2: Write the equivalence test**

The refactor must not change which moves are found — only how fast. Create
`shared/sim/components.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { scoreTurn } from "../engine/score";
import { validateTurn } from "../engine/legality";
import { indexWords } from "./words";
import { anchors, components, moveKey } from "./components";

const WORDS = ["AT", "ATE", "EAT", "TEA", "CAT", "CATS", "COT", "COTS", "ACE",
  "TEN", "AN", "NET", "TO", "ON", "NO", "SO", "OAT", "OATS", "SAT", "SEA"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);

const find = (board: Board, letters: string[], blanks = 0) =>
  components(board, { letters, blanks }, dictionary, words, shape, 15,
    (b, p) => scoreTurn(b, p, { before: board }).total, {});

describe("anchors", () => {
  test("an empty board offers only the centre", () => {
    expect([...anchors(makeBoard([]), shape, 15)]).toEqual(["7,7"]);
  });

  test("a played tile offers itself and its four neighbours", () => {
    const live = anchors(makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]), shape, 15);
    expect(live).toEqual(new Set(["7,7", "8,7", "6,7", "7,8", "7,6"]));
  });

  test("neighbours off the edge are not anchors", () => {
    const live = anchors(makeBoard([{ x: 0, y: 0, letter: "A", isBlank: false }]), shape, 15);
    expect(live).toEqual(new Set(["0,0", "1,0", "0,1"]));
  });
});

describe("the component search", () => {
  test("opens across the centre", () => {
    const moves = find(makeBoard([]), ["C", "A", "T"]);

    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.placements.some((p) => p.x === 7 && p.y === 7))).toBe(true);
  });

  test("every move it returns is legal", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    const moves = find(board, ["S", "O", "E", "A"]);
    expect(moves.length).toBeGreaterThan(0);

    for (const move of moves) {
      const legality = validateTurn(board, move.placements, dictionary,
        { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre });
      expect(legality).toEqual({ ok: true });
    }
  });

  test("scores against the board it was given, not the board it makes", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    // CATS: four letters, three of them already down. One tile, four points.
    const cats = find(board, ["S"]).find((m) =>
      m.placements.length === 1 && m.placements[0]!.letter === "S");
    expect(cats!.score).toBe(4);
  });

  test("finds nothing when the rack cannot reach the board", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    expect(find(board, ["Q", "Z"])).toEqual([]);
  });

  test("offers each turn once", () => {
    const board = makeBoard([..."CAT"].map((letter, i) => ({
      x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
    })));

    // The same placement is reachable from more than one span -- laying S on
    // the end of CAT is found as part of CATS and again as part of ATS. The
    // search used to return it twice, which lets the difficulty bands count
    // one move as several.
    const keys = find(board, ["S", "O", "A"]).map((m) => moveKey(m.placements));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/components.test.ts`
Expected: FAIL — `Cannot find module './components'`.

- [ ] **Step 4: Create `components.ts`**

Move `Span`, `spans`, `Hand`, `fit`, and the body of `rank` (minus the sort
and the lookahead block) into `shared/sim/components.ts`. Keep every doc
comment. Then apply the two changes:

**(a) `anchors`, replacing the inline `live` set.** Same contents, but now a
named export so chaining and the tests can use it:

```ts
/**
 * Squares worth building through: occupied, or touching something occupied.
 * On an empty board there is only one -- the centre the opening must cover.
 */
export function anchors(board: Board, shape: BoardShape, size: number): Set<string> {
  const live = new Set<string>();

  if (board.size === 0) {
    live.add(cellKey(shape.centre.x, shape.centre.y));
    return live;
  }

  for (const key of board.keys()) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    live.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) live.add(cellKey(nx, ny));
    }
  }

  return live;
}
```

**(b) `moveKey`, and dedupe with it.** The same turn is reachable from more
than one span, and the search returns it once per route:

```ts
/**
 * A turn's identity, independent of the order its tiles were found in.
 *
 * One placement is reachable down several spans -- an S on the end of CAT
 * turns up as CATS and again as ATS -- and later the chained search and the
 * block solver each find some of the same turns a third and fourth way.
 * Without a canonical key the ranked list fills with one move wearing
 * different hats, and the difficulty bands count it repeatedly.
 */
export function moveKey(placements: readonly Placement[]): string {
  return [...placements]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((p) => `${p.x},${p.y},${p.letter},${p.isBlank ? 1 : 0}`)
    .join("|");
}
```

Hold a `Set<string>` in `components` and skip a move whose key is already in
it, before the `validateTurn` call — the duplicate would only be validated and
scored to be thrown away.

**(c) Enumerate spans from anchors, not from the whole board.** Replace
`spans(size, length)` with a generator that only yields spans containing at
least one anchor, deduped:

```ts
/**
 * Every straight run of `length` cells that contains a live square.
 *
 * Walking the whole board and asking afterwards whether each span touched
 * play meant reading two and a half thousand spans a turn, nearly all of them
 * nowhere near a tile. Starting from the live squares and working outward
 * asks the same question the other way round.
 */
function* spansThrough(
  live: ReadonlySet<string>,
  size: number,
  length: number,
): Generator<Span> {
  const seen = new Set<string>();

  for (const key of live) {
    const [ax, ay] = key.split(",").map(Number) as [number, number];

    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      // Offsets that put the anchor somewhere inside the span.
      for (let back = 0; back < length; back++) {
        const x = ax - back * dx;
        const y = ay - back * dy;
        if (x < 0 || y < 0) continue;
        if (x + (length - 1) * dx >= size || y + (length - 1) * dy >= size) continue;

        const id = `${x},${y},${dx}`;
        if (seen.has(id)) continue;
        seen.add(id);
        yield { x, y, dx, dy, length };
      }
    }
  }
}
```

The `touchesLive` check inside the span-reading loop now always passes, so
delete it and the variable. Keep the `blockedSquare` and `free > tiles`
checks.

**(d) If the profile named `isOneMass` as the cost**, add a fast path. The
bot's `fit` already establishes that a move touches the existing mass, so
full-board connectivity is settled. Add to `validateTurn`'s `Bounds`:

```ts
/**
 * Skip the whole-board connectivity walk.
 *
 * Only for a caller that has already established the move touches the mass --
 * the bot's search, which checks exactly that in `fit` before it gets here,
 * and which would otherwise pay a BFS of the whole board for every one of the
 * thousands of candidates it weighs a turn. The move is still checked in
 * every other respect.
 */
connected?: boolean;
```

In `validateTurn`, guard the existing call:

```ts
if (bounds.connected !== true && !isOneMass(after, from)) {
  faults.push({ reason: "disconnected" });
}
```

`components` passes `connected: true`. **`convex/bots.ts` must not** — the
authoritative check on the move a bot actually plays stays complete.

- [ ] **Step 5: Make `rank` delegate**

Move `Move` and `Hand` from `bot.ts` into `components.ts` and re-export them,
so `bot.ts` keeps its public surface:

```ts
export { components, anchors, moveKey, type Hand, type Move, type ValueFn } from "./components.js";
```

`rank` in `bot.ts` becomes the thin orchestrator:

```ts
export function rank(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: (board: Board, placements: readonly Placement[]) => number,
  options: MoveOptions,
): Move[] {
  const found = components(board, hand, dictionary, words, shape, size, scoreOf, {
    maxLength: options.maxLength,
  });

  const ahead = options.lookahead;
  if (ahead === undefined || found.length === 0) return found;

  // ... the existing lookahead block, unchanged from Task 2
}
```

- [ ] **Step 6: Pin the budget**

Add to `shared/sim/components.test.ts`:

```ts
test("stays inside its time budget on a busy board", () => {
  // A mid-game board: a cross of words with plenty of anchors around it.
  const tiles = [
    ...[..."CATS"].map((letter, i) => ({ x: 5 + i, y: 7, letter, isBlank: false })),
    ...[..."OAT"].map((letter, i) => ({ x: 5, y: 8 + i, letter, isBlank: false })),
    ...[..."NET"].map((letter, i) => ({ x: 8 + i, y: 5, letter, isBlank: false })),
  ];
  const board = makeBoard(tiles);

  const started = performance.now();
  for (let i = 0; i < 20; i++) find(board, ["S", "O", "E", "A", "T", "N", "C"]);
  const each = (performance.now() - started) / 20;

  // Generous, because CI machines vary. This exists to catch a regression of
  // the kind that makes chaining unaffordable, not to police milliseconds.
  expect(each).toBeLessThan(50);
});
```

Note this uses the small `WORDS` list, so it is a relative guard rather than a
real-dictionary measurement. Also record the real number:

```bash
time npx tsx scripts/simulate.ts 5 2
```

Write the before and after seconds into the commit message. The target is a
material drop; if it has not moved, the profile in Step 1 was misread — go
back to it rather than proceeding.

- [ ] **Step 7: Run the whole suite**

Run: `npx vitest run --project engine && npm run typecheck`
Expected: PASS. `shared/sim/bot.test.ts` must pass **unchanged** — it is the
equivalence check that this refactor found the same moves.

- [ ] **Step 8: Commit**

```bash
git add shared/sim/components.ts shared/sim/components.test.ts \
        shared/sim/bot.ts shared/engine/legality.ts
git commit -m "perf(bot): search out from the live squares

Sim of 5 games: <before>s -> <after>s."
```

---

## Task 5: A property test that no illegal move can escape

The next two tasks build turns no single-span search would ever propose. This
is the net that catches them. **Build it before them, not after.**

**Files:**
- Create: `shared/sim/legality.property.test.ts`

**Interfaces:**
- Consumes: everything through Task 4.
- Produces: nothing. A test.

- [ ] **Step 1: Write the test**

Create `shared/sim/legality.property.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { applyPlacements, validateTurn } from "../engine/legality";
import { scoreTurn } from "../engine/score";
import { indexWords } from "./words";
import { rank } from "./bot";

/*
 * The real dictionary, because a toy one makes toy boards -- and the moves
 * worth catching are the ones that only appear when there is enough of a board
 * to build on.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const all: string[] = JSON.parse(
  readFileSync(join(ROOT, "shared", "data", "words.json"), "utf8"),
);
const dictionary = makeDictionary(all);
const words = indexWords(all.filter((w) => w.length <= 7), 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const bounds = { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre };

const LETTERS = "AAAABBCCDDEEEEEFFGGHHIIIIJKLLMMNNNOOOOPPQRRRSSSTTTUUVWXYZ";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("every move the search offers is legal", () => {
  /*
   * Boards are grown by playing the search's own moves, so they are the
   * boards the bot actually meets rather than ones invented for the test.
   * Every move offered at every step is checked, not just the one taken.
   */
  test.each([1, 2, 3, 4, 5, 6, 7, 8])("game seeded %i", (seed) => {
    const rng = seeded(seed);
    let board: Board = makeBoard([]);
    let checked = 0;

    for (let turn = 0; turn < 25; turn++) {
      const letters = Array.from({ length: 7 }, () =>
        LETTERS[Math.floor(rng() * LETTERS.length)]!);
      const blanks = turn % 5 === 0 ? 1 : 0;
      const before = board;

      const moves = rank(board, { letters, blanks }, dictionary, words, shape, 15,
        (b, p) => scoreTurn(b, p, { before }).total, {});

      for (const move of moves) {
        // The real check, with no `connected` shortcut: the full rules.
        const legality = validateTurn(before, move.placements, dictionary, bounds);
        if (!legality.ok) {
          throw new Error(
            `illegal move offered on turn ${turn}: ` +
            `${JSON.stringify(move.placements)} — ${JSON.stringify(legality.faults)}`,
          );
        }
        checked++;
      }

      if (moves.length === 0) break;
      board = applyPlacements(board, moves[Math.floor(rng() * moves.length)]!.placements);
    }

    // A test that checked nothing would pass silently.
    expect(checked).toBeGreaterThan(50);
  });
});

describe("every move the search offers scores what it claims", () => {
  test("score matches a fresh scoring of the same placements", () => {
    const rng = seeded(99);
    let board: Board = makeBoard([]);

    for (let turn = 0; turn < 12; turn++) {
      const letters = Array.from({ length: 7 }, () =>
        LETTERS[Math.floor(rng() * LETTERS.length)]!);
      const before = board;

      const moves = rank(board, { letters, blanks: 0 }, dictionary, words, shape, 15,
        (b, p) => scoreTurn(b, p, { before }).total, {});
      if (moves.length === 0) break;

      for (const move of moves.slice(0, 40)) {
        const after = applyPlacements(before, move.placements);
        expect(move.score).toBe(scoreTurn(after, move.placements, { before }).total);
      }

      board = applyPlacements(board, moves[0]!.placements);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --project engine shared/sim/legality.property.test.ts`
Expected: PASS. It should take a few seconds — it indexes the real
dictionary once and plays eight short games.

If it **fails now**, before chaining exists, you have found a pre-existing bug
in the current search. Stop and fix that first; do not build on it.

- [ ] **Step 3: Commit**

```bash
git add shared/sim/legality.property.test.ts
git commit -m "test(bot): no illegal move escapes the search"
```

---
## Task 6: Chaining — more than one component in a turn

**Files:**
- Create: `shared/sim/chain.ts`
- Create: `shared/sim/chain.test.ts`
- Modify: `shared/sim/components.ts` (only if chaining needs a `before` it does not already accept)
- Modify: `shared/sim/bot.ts` (`rank` folds chained moves in; `ValueFn` type)
- Modify: `shared/sim/game.ts` (pass the turn's starting board — see Step 1)
- Modify: `shared/sim/variants.ts` (`turnValue` takes a `before` board)

**Interfaces:**
- Consumes: `components`, `anchors`, `Move`, `Hand` from Task 4.
- Produces:
  - `export type ValueFn = (after: Board, placements: readonly Placement[], before: Board) => number` — defined in `components.ts` alongside `Move`, re-exported by `bot.ts`
  - `export function moveKey(placements: readonly Placement[]): string` (in `components.ts`)
  - `export function chain(board: Board, hand: Hand, dictionary: Dictionary, words: WordIndex, shape: BoardShape, size: number, scoreOf: ValueFn, options: { depth: number; breadth: number; maxLength?: number }): Move[]`

- [ ] **Step 1: Thread the starting board through the simulator**

Task 2 gave the value callback its three-argument shape and Task 4 typed
`components` with it. The simulator has not caught up, and there is a second
instance of the same bug waiting there.

`shared/sim/variants.ts:turnValue` calls `scoreTurn(board, placements)` with
no `before`. `scoreTurn` then defaults `before` to the board minus the placed
cells — which **erases the tile underneath a stacked placement entirely**. So
in the simulator a stacked tile scores no stack bonus (`before.get(key)` is
`undefined`, depth reads 1, no bonus), and a k x k block that was already
complete looks newly completed and pays again. `convex/bots.ts` passes
`{ before: board }` and gets this right; the simulator does not. **Every
stacking and square number the sim has produced is off because of this.**

In `shared/sim/variants.ts`, give `turnValue` the board it is missing:

```ts
export function turnValue(
  board: Board,
  placements: readonly Placement[],
  variant: Variant,
  claimed: ReadonlySet<string>,
  before?: Board,
): TurnValue {
  const base = scoreTurn(board, placements, { before }).total;
  // ... unchanged from here
```

`scoreTurn`'s `ScoreOptions.before` is already optional and already falls back
to the old behaviour, so passing `undefined` changes nothing for any other
caller.

In `shared/sim/game.ts`, thread it through both call sites:

```ts
value: (after, p, before) => turnValue(after, p, variant, claimed, before).score,
```

and the scoring of the move actually taken:

```ts
const { score, doubled } = turnValue(
  applyPlacements(board, move.placements), move.placements, variant, claimed, board,
);
```

Note this reorders the existing line — `turnValue` was being called with
`board` (the board *before* the move) as its first argument, which is a second
instance of the same confusion. It wants the board *after*.

`components` and `rank` already take `ValueFn` — this step only brings the
simulator's callers into line with it.

- [ ] **Step 2: Write the failing test**

Create `shared/sim/chain.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { applyPlacements, validateTurn } from "../engine/legality";
import { scoreTurn } from "../engine/score";
import { indexWords } from "./words";
import { chain } from "./chain";

const WORDS = ["AT", "TO", "ON", "NO", "AN", "IT", "IS", "SO", "OX", "AX",
  "CAT", "CATS", "OAT", "OATS", "TON", "NOT", "SAT", "SIT", "TIN", "NIT"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const bounds = { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre };

const chained = (board: Board, letters: string[], depth = 2, breadth = 6) =>
  chain(board, { letters, blanks: 0 }, dictionary, words, shape, 15,
    (after, p, before) => scoreTurn(after, p, { before }).total,
    { depth, breadth });

describe("chaining", () => {
  /** CAT across the middle: room to play on either side of it. */
  const board = makeBoard([..."CAT"].map((letter, i) => ({
    x: 6 + i, y: 7, letter, isBlank: false, stacked: 1,
  })));

  test("offers turns that touch the board in more than one place", () => {
    const moves = chained(board, ["S", "O", "T", "A", "N"]);

    const spread = moves.filter((m) => {
      const rows = new Set(m.placements.map((p) => p.y));
      const cols = new Set(m.placements.map((p) => p.x));
      // Neither a single row nor a single column: not one span.
      return rows.size > 1 && cols.size > 1;
    });

    expect(spread.length).toBeGreaterThan(0);
  });

  test("every chained turn is legal as a whole", () => {
    for (const move of chained(board, ["S", "O", "T", "A", "N"])) {
      expect(validateTurn(board, move.placements, dictionary, bounds)).toEqual({ ok: true });
    }
  });

  test("scores the whole turn at once, against the board it started from", () => {
    for (const move of chained(board, ["S", "O", "T", "A", "N"])) {
      const after = applyPlacements(board, move.placements);
      expect(move.score).toBe(scoreTurn(after, move.placements, { before: board }).total);
    }
  });

  test("never spends a letter it does not hold", () => {
    for (const move of chained(board, ["S", "O", "T"])) {
      const spent = move.placements.filter((p) => !p.isBlank).map((p) => p.letter).sort();
      const held = ["O", "S", "T"];
      for (const letter of new Set(spent)) {
        expect(spent.filter((l) => l === letter).length)
          .toBeLessThanOrEqual(held.filter((l) => l === letter).length);
      }
    }
  });

  test("offers no duplicates", () => {
    const moves = chained(board, ["S", "O", "T", "A"]);
    const keys = moves.map((m) => JSON.stringify(
      [...m.placements].sort((a, b) => a.x - b.x || a.y - b.y)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("depth 1 is exactly the single-span search", () => {
    const one = chained(board, ["S", "O", "T", "A"], 1);
    expect(one.every((m) => {
      const rows = new Set(m.placements.map((p) => p.y));
      const cols = new Set(m.placements.map((p) => p.x));
      return rows.size === 1 || cols.size === 1;
    })).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/chain.test.ts`
Expected: FAIL — `Cannot find module './chain'`.

- [ ] **Step 4: Write `chain.ts`**

`moveKey` already exists in `components.ts` from Task 4 — import it, do not
redefine it.

```ts
import { applyPlacements } from "../engine/legality.js";
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
```

- [ ] **Step 5: Fold chained moves into `rank`**

In `shared/sim/bot.ts`, extend `MoveOptions`:

```ts
/**
 * How many plays may make up one turn, and how many candidates each step
 * considers. Depth 1 is the single-span search this started as.
 */
chain?: { depth: number; breadth: number };
```

and in `rank`, replace the `components` call with:

```ts
const chaining = options.chain ?? { depth: 2, breadth: 6 };
const found = chaining.depth <= 1
  ? components(board, hand, dictionary, words, shape, size, scoreOf,
      { maxLength: options.maxLength, before: board })
  : chain(board, hand, dictionary, words, shape, size, scoreOf,
      { ...chaining, maxLength: options.maxLength });
```

Chaining at depth 1 already returns exactly the single-span moves, so the
branch is only there to skip the wrapper's bookkeeping.

- [ ] **Step 6: Run everything**

Run: `npx vitest run --project engine && npm run typecheck`
Expected: PASS — including `legality.property.test.ts` from Task 5, which now
exercises chained turns. **If it fails, the chaining is producing illegal
moves; that is exactly what it is for. Fix before continuing.**

- [ ] **Step 7: Check the cost**

```bash
time npx tsx scripts/simulate.ts 5 2
```

Record the seconds. Expect a rise over Task 4's number — chaining is doing
strictly more work. If it has risen more than about sevenfold (depth 2,
breadth 6 = seven component searches), something is re-searching that should
not be.

- [ ] **Step 8: Commit**

```bash
git add shared/sim/chain.ts shared/sim/chain.test.ts shared/sim/components.ts \
        shared/sim/bot.ts shared/sim/game.ts shared/sim/variants.ts
git commit -m "feat(bot): a turn may be more than one play

Also fixes the simulator scoring turns without the board they began on,
which cost every stacked tile its bonus and paid for squares twice."
```

---
## Task 7: Deliberate squares — the block solver

Chaining composes plays that are each legal alone. Some turns are legal only
as a whole: a tile whose run is not a word until the tile beside it lands.
That is the 3x3 case, and it needs its own solver.

**Files:**
- Create: `shared/sim/blocks.ts`
- Create: `shared/sim/blocks.test.ts`
- Modify: `shared/sim/bot.ts` (`rank` merges block moves in)

**Interfaces:**
- Consumes: `moveKey`, `Hand`, `Move`, `ValueFn` from `components.ts`.
- Produces:
  - `export interface Candidate { k: number; x: number; y: number; empties: Coord[] }`
  - `export function candidateBlocks(board: Board, shape: BoardShape, size: number, tiles: number, maxK: number): Candidate[]` — blocks worth trying, best payoff first.
  - `export function blockMoves(board: Board, hand: Hand, dictionary: Dictionary, words: WordIndex, shape: BoardShape, size: number, scoreOf: ValueFn, options: { maxK?: number; maxBlocks?: number; nodeLimit?: number }): Move[]`

- [ ] **Step 1: Write the failing test**

Create `shared/sim/blocks.test.ts`. The 3x3 fixture is the one already proven
in `shared/engine/integration.test.ts` — `ACE`/`CAM`/`EMU`, reading as those
three words across *and* down.

```ts
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { cellKey, makeBoard, type Board } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { validateTurn } from "../engine/legality";
import { scoreTurn } from "../engine/score";
import { indexWords } from "./words";
import { blockMoves, candidateBlocks } from "./blocks";

const WORDS = ["ACE", "CAM", "EMU", "AC", "CA", "EM", "ME", "AE", "MU", "UM",
  "AT", "CAT", "CATS", "AS", "SO", "ON", "NO", "OAT"];
const dictionary = makeDictionary(WORDS);
const words = indexWords(WORDS, 7);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const bounds = { width: 15, height: 15, blocked: shape.blocked, centre: shape.centre };

const solve = (board: Board, letters: string[], blanks = 0) =>
  blockMoves(board, { letters, blanks }, dictionary, words, shape, 15,
    (after, p, before) => scoreTurn(after, p, { before }).total, {});

describe("candidate blocks", () => {
  test("ignores blocks with no way to reach the board", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    const blocks = candidateBlocks(board, shape, 15, 7, 3);

    // Every candidate either contains a tile or sits next to one.
    for (const block of blocks) {
      const cells = [];
      for (let dy = -1; dy <= block.k; dy++) {
        for (let dx = -1; dx <= block.k; dx++) cells.push(cellKey(block.x + dx, block.y + dy));
      }
      expect(cells.some((key) => board.has(key))).toBe(true);
    }
  });

  test("ignores blocks needing more tiles than the rack holds", () => {
    const board = makeBoard([{ x: 7, y: 7, letter: "A", isBlank: false }]);
    for (const block of candidateBlocks(board, shape, 15, 3, 3)) {
      expect(block.empties.length).toBeLessThanOrEqual(3);
    }
  });

  test("ignores blocks that are already full", () => {
    const board = makeBoard([
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 8, letter: "C", isBlank: false }, { x: 8, y: 8, letter: "A", isBlank: false },
    ]);
    expect(candidateBlocks(board, shape, 15, 7, 2)
      .some((b) => b.k === 2 && b.x === 7 && b.y === 7)).toBe(false);
  });
});

describe("the block solver", () => {
  test("builds a 3x3 word square in one turn", () => {
    //   A C E
    //   C A M     across and down both read ACE, CAM, EMU
    //   E M U
    // Six of nine already down; the rack supplies the rest.
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const moves = solve(board, ["E", "M", "U"]);
    const full = moves.find((m) => m.placements.length === 3);

    expect(full).toBeDefined();
    expect(new Set(full!.placements.map((p) => `${p.x},${p.y},${p.letter}`)))
      .toEqual(new Set(["6,8,E", "7,8,M", "8,8,U"]));
  });

  test("the completed 3x3 pays for the square and its nested 2x2s", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const full = solve(board, ["E", "M", "U"]).find((m) => m.placements.length === 3)!;
    // Two 2x2s close (4 each) and the 3x3 (9), on top of the words formed.
    expect(full.score).toBeGreaterThanOrEqual(9 + 4 + 4);
  });

  test("every solution is legal", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const moves = solve(board, ["E", "M", "U", "A", "C"]);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(validateTurn(board, move.placements, dictionary, bounds)).toEqual({ ok: true });
    }
  });

  test("finds nothing when the rack cannot spell the square", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    expect(solve(board, ["X", "X", "X"]).some((m) => m.placements.length === 3)).toBe(false);
  });

  test("a blank can stand in for a letter the rack lacks", () => {
    const board = makeBoard([
      { x: 6, y: 6, letter: "A", isBlank: false }, { x: 7, y: 6, letter: "C", isBlank: false },
      { x: 8, y: 6, letter: "E", isBlank: false }, { x: 6, y: 7, letter: "C", isBlank: false },
      { x: 7, y: 7, letter: "A", isBlank: false }, { x: 8, y: 7, letter: "M", isBlank: false },
    ]);

    const moves = blockMoves(board, { letters: ["E", "M"], blanks: 1 }, dictionary, words,
      shape, 15, (after, p, before) => scoreTurn(after, p, { before }).total, {});

    const full = moves.find((m) => m.placements.length === 3);
    expect(full).toBeDefined();
    expect(full!.placements.some((p) => p.isBlank)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/blocks.test.ts`
Expected: FAIL — `Cannot find module './blocks'`.

- [ ] **Step 3: Write the shortlist**

Create `shared/sim/blocks.ts`:

```ts
import { STACK_CAP } from "../config.js";
import { cellKey, type Board, type Coord } from "../engine/board.js";
import { applyPlacements, validateTurn, type Dictionary } from "../engine/legality.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";
import type { WordIndex } from "./words.js";
import { moveKey, type Hand, type Move, type ValueFn } from "./components.js";

export interface Candidate {
  k: number;
  x: number;
  y: number;
  empties: Coord[];
}

/**
 * Blocks worth trying to finish this turn.
 *
 * The general search cannot reach a word square, because the tiles that make
 * one are only legal together -- a letter whose run spells nothing until the
 * letter beside it lands. So the squares are sought directly. That is only
 * affordable because the list is short: a block has to be reachable, unfinished,
 * and within a rack of filling.
 */
export function candidateBlocks(
  board: Board,
  shape: BoardShape,
  size: number,
  tiles: number,
  maxK: number,
): Candidate[] {
  const found: Candidate[] = [];

  for (let k = 2; k <= maxK; k++) {
    for (let y = 0; y + k <= size; y++) {
      for (let x = 0; x + k <= size; x++) {
        const empties: Coord[] = [];
        let blocked = false;
        let holdsTile = false;

        for (let j = 0; j < k && !blocked; j++) {
          for (let i = 0; i < k; i++) {
            const key = cellKey(x + i, y + j);
            if (shape.blocked.has(key)) {
              blocked = true;
              break;
            }
            if (board.has(key)) holdsTile = true;
            else empties.push({ x: x + i, y: y + j });
          }
        }

        // Already finished pays nothing; more gaps than tiles cannot be closed.
        if (blocked || empties.length === 0 || empties.length > tiles) continue;

        /*
         * The filled block must join the mass. A block holding a tile already
         * does; one that does not needs a tile against its edge, since a k x k
         * of new tiles is itself connected and only needs one point of contact.
         */
        if (!holdsTile && !touchesBoard(board, x, y, k, size)) continue;

        // Nothing is on the board at all: only the opening square will do.
        if (board.size === 0) {
          const centre = shape.centre;
          const inside = centre.x >= x && centre.x < x + k && centre.y >= y && centre.y < y + k;
          if (!inside) continue;
        }

        found.push({ k, x, y, empties });
      }
    }
  }

  // Biggest payoff first, and among equals the ones needing fewest tiles.
  found.sort((a, b) => b.k - a.k || a.empties.length - b.empties.length);
  return found;
}

function touchesBoard(board: Board, x: number, y: number, k: number, size: number): boolean {
  for (let i = 0; i < k; i++) {
    for (const [cx, cy] of [
      [x + i, y - 1], [x + i, y + k], [x - 1, y + i], [x + k, y + i],
    ] as const) {
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
      if (board.has(cellKey(cx, cy))) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Write the solver**

Append to `shared/sim/blocks.ts`:

```ts
const ALPHABET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/**
 * The maximal run through a cell along one axis, and whether it is settled.
 *
 * A run is only worth checking against the dictionary once nothing can still
 * extend it. If the square just past either end is a gap this turn still
 * intends to fill, the word is not finished being written.
 */
function runAt(
  provisional: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  pending: ReadonlySet<string>,
): { word: string; settled: boolean } {
  let sx = x;
  let sy = y;
  while (provisional.has(cellKey(sx - dx, sy - dy))) {
    sx -= dx;
    sy -= dy;
  }

  let word = "";
  let ex = sx;
  let ey = sy;
  while (provisional.has(cellKey(ex, ey))) {
    word += provisional.get(cellKey(ex, ey))!.letter;
    ex += dx;
    ey += dy;
  }

  const settled =
    !pending.has(cellKey(sx - dx, sy - dy)) && !pending.has(cellKey(ex, ey));
  return { word, settled };
}

/**
 * Every way this rack can finish this block.
 *
 * Plain backtracking over the gaps, checking each word the moment it is
 * finished rather than at the end -- a wrong letter in the top row is caught
 * before the bottom row is ever tried, which is what keeps a nine-cell search
 * from being a nine-deep one.
 */
function solveBlock(
  board: Board,
  block: Candidate,
  hand: Hand,
  dictionary: Dictionary,
  nodeLimit: number,
): Placement[][] {
  const solutions: Placement[][] = [];
  const provisional = new Map(board);
  const placements: Placement[] = [];
  let nodes = 0;

  const walk = (at: number, letters: string[], blanks: number) => {
    if (nodes++ > nodeLimit) return;

    if (at === block.empties.length) {
      solutions.push(placements.map((p) => ({ ...p })));
      return;
    }

    const { x, y } = block.empties[at]!;
    const key = cellKey(x, y);
    // Gaps this turn has yet to fill: a run reaching one is not finished.
    const pending = new Set(block.empties.slice(at + 1).map((c) => cellKey(c.x, c.y)));

    const ok = () => {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const { word, settled } = runAt(provisional, x, y, dx, dy, pending);
        if (!settled || word.length < 2) continue;
        if (!dictionary.has(word)) return false;
      }
      return true;
    };

    const tryLetter = (letter: string, isBlank: boolean, rest: string[], left: number) => {
      provisional.set(key, { letter, isBlank, stacked: 1 });
      placements.push({ x, y, letter, isBlank });

      if (ok()) walk(at + 1, rest, left);

      placements.pop();
      provisional.delete(key);
    };

    const tried = new Set<string>();
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i]!;
      if (tried.has(letter)) continue;
      tried.add(letter);
      tryLetter(letter, false, [...letters.slice(0, i), ...letters.slice(i + 1)], blanks);
    }

    /*
     * A blank may stand for anything -- subject to the rule as written, not as
     * it happens to read today. At STACK_CAP 2 a blank can never land on a
     * tile, so these gaps always allow one; raise the cap and that changes.
     */
    if (blanks > 0) {
      const priorStack = board.get(key)?.stacked ?? 0;
      const barred = priorStack + 1 >= STACK_CAP && priorStack > 0;
      if (!barred) {
        for (const letter of ALPHABET) {
          if (tried.has(letter)) continue;
          tryLetter(letter, true, letters, blanks - 1);
        }
      }
    }
  };

  walk(0, [...hand.letters], hand.blanks);
  return solutions;
}

/**
 * Turns that finish a k x k block, which the general search cannot see.
 */
export function blockMoves(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: { maxK?: number; maxBlocks?: number; nodeLimit?: number } = {},
): Move[] {
  const tiles = hand.letters.length + hand.blanks;
  const blocks = candidateBlocks(board, shape, size, tiles, options.maxK ?? 4)
    .slice(0, options.maxBlocks ?? 12);

  const bounds = {
    width: size,
    height: size,
    blocked: shape.blocked,
    centre: shape.centre,
  };

  const found: Move[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    for (const placements of solveBlock(board, block, hand, dictionary,
                                        options.nodeLimit ?? 20_000)) {
      const key = moveKey(placements);
      if (seen.has(key)) continue;
      seen.add(key);

      // The solver only checks the runs it closes. The full rules -- buried
      // words, connectivity, the blank rules -- have the last word.
      if (!validateTurn(board, placements, dictionary, bounds).ok) continue;

      const after = applyPlacements(board, placements);
      const score = scoreOf(after, placements, board);
      found.push({ placements, score, value: score });
    }
  }

  found.sort((a, b) => b.value - a.value);
  return found;
}
```

`words` is unused in `blockMoves` as written — keep it in the signature for
symmetry with the other stages, and prefix it `_words` if the linter objects.

- [ ] **Step 5: Merge block moves into `rank`**

In `shared/sim/bot.ts`, extend `MoveOptions`:

```ts
/** How far to go looking for k x k blocks to finish. */
squares?: { maxK: number; maxBlocks: number };
```

and after the chained search:

```ts
const blocks = blockMoves(board, hand, dictionary, words, shape, size, scoreOf,
  options.squares ?? {});

// Both searches reach some of the same turns; the key settles it.
const merged = [...found];
const known = new Set(found.map((m) => moveKey(m.placements)));
for (const move of blocks) {
  if (known.has(moveKey(move.placements))) continue;
  merged.push(move);
}
merged.sort((a, b) => b.value - a.value);
```

Use `merged` from there on.

- [ ] **Step 6: Run everything**

Run: `npx vitest run --project engine && npm run typecheck`
Expected: PASS, `legality.property.test.ts` included.

- [ ] **Step 7: Confirm it changed the game**

```bash
npx tsx scripts/simulate.ts 20 2
```

The `3x3+` column measured **0.00–0.15 per game** before this work. It should
now be materially higher. Record the number in the commit message — this is
the task's whole justification.

- [ ] **Step 8: Commit**

```bash
git add shared/sim/blocks.ts shared/sim/blocks.test.ts shared/sim/bot.ts
git commit -m "feat(bot): build the squares on purpose

3x3+ per game across 20 games: <before> -> <after>."
```

---
## Task 8: Judgement — what a move leaves behind

A bot that builds squares and then hands them over has learned half a skill.
"Completer takes it" (design.md §4.4) means a block left one tile short is a
gift.

**Files:**
- Create: `shared/sim/judgement.ts`
- Create: `shared/sim/judgement.test.ts`
- Modify: `shared/sim/bot.ts` (`rank` sets `value` from `score` less the penalty)

**Interfaces:**
- Consumes: `Move` from Task 2.
- Produces:
  - `export interface ExposureWeights { nearBlock: number; openRun: number; stackable: number }`
  - `export const DEFAULT_EXPOSURE: ExposureWeights`
  - `export function exposure(before: Board, placements: readonly Placement[], shape: BoardShape, size: number, weights?: Partial<ExposureWeights>): number`

- [ ] **Step 1: Write the failing test**

Create `shared/sim/judgement.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { DEFAULT_EXPOSURE, exposure } from "./judgement";

const shape = boardShapeNamed(OPEN_BOARD, 15);
const at = (x: number, y: number, letter: string) => ({ x, y, letter, isBlank: false });

describe("exposure", () => {
  test("a move leaving a 2x2 one tile short is penalised", () => {
    // Three corners of a 2x2 at (7,7). The move adds the third; the fourth
    // is a four-point gift to whoever plays next.
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    const risky = exposure(before, [at(7, 8, "T")], shape, 15);

    expect(risky).toBeGreaterThan(0);
  });

  test("closing the block yourself leaves nothing to take", () => {
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T"), at(7, 8, "T")]);

    const closing = exposure(before, [at(8, 8, "O")], shape, 15);
    const opening = exposure(makeBoard([at(7, 7, "A"), at(8, 7, "T")]),
      [at(7, 8, "T")], shape, 15);

    expect(closing).toBeLessThan(opening);
  });

  test("a longer word left open is worth more to the opponent", () => {
    const short = makeBoard([at(6, 7, "A"), at(7, 7, "T")]);
    const long = makeBoard([...["C", "A", "T", "S"].map((l, i) => at(4 + i, 7, l))]);

    expect(exposure(long, [at(8, 7, "O")], shape, 15))
      .toBeGreaterThan(exposure(short, [at(8, 7, "O")], shape, 15));
  });

  test("weights can be turned off individually", () => {
    const before = makeBoard([at(7, 7, "A"), at(8, 7, "T")]);
    const off = exposure(before, [at(7, 8, "T")], shape, 15,
      { nearBlock: 0, openRun: 0, stackable: 0 });

    expect(off).toBe(0);
  });

  test("the defaults are the ones the spec names", () => {
    expect(DEFAULT_EXPOSURE).toEqual({ nearBlock: 0.6, openRun: 0.15, stackable: 0.1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/judgement.test.ts`
Expected: FAIL — `Cannot find module './judgement'`.

- [ ] **Step 3: Write `judgement.ts`**

Note the deliberate absence of `applyPlacements`: this runs for every
candidate move, and copying the board map each time would cost more than the
search that produced them. An overlay lookup answers the same question.

```ts
import { STACK_CAP } from "../config.js";
import { cellKey, type Board } from "../engine/board.js";
import type { Placement } from "../engine/score.js";
import type { BoardShape } from "../boards.js";

export interface ExposureWeights {
  /** Per k^2, for a block left one tile from complete. */
  nearBlock: number;
  /** Per letter, for a word left extendable. */
  openRun: number;
  /** Per tile left able to be stacked on. */
  stackable: number;
}

/**
 * Starting weights, to be tuned in the simulator rather than trusted.
 *
 * A donated 2x2 costs about 2.4 against a move, which is roughly what it is
 * worth to take one. These exist so the first measurement has something to
 * measure; they are not claims.
 */
export const DEFAULT_EXPOSURE: ExposureWeights = {
  nearBlock: 0.6,
  openRun: 0.15,
  stackable: 0.1,
};

/**
 * What a move leaves for the next player, in points they can expect to take.
 *
 * A greedy player takes the most on offer and hands the board over however
 * open it leaves things -- which in this game is most of the mistake, because
 * "completer takes it" means a block one tile short is simply a gift. Reading
 * that costs nothing here: exposure is countable geometry, not the fuzzy
 * judgement it would be in a game with premium squares.
 *
 * Only what the move touched is examined. Anything further away was already
 * exposed before the move and is not this move's doing.
 */
export function exposure(
  before: Board,
  placements: readonly Placement[],
  shape: BoardShape,
  size: number,
  weights: Partial<ExposureWeights> = {},
): number {
  const w = { ...DEFAULT_EXPOSURE, ...weights };
  const laid = new Map(placements.map((p) => [cellKey(p.x, p.y), p]));

  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size &&
    (laid.has(cellKey(x, y)) || before.has(cellKey(x, y)));

  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size &&
    !shape.blocked.has(cellKey(x, y)) && !filled(x, y);

  let penalty = 0;

  // Blocks one tile from complete, counted once each.
  const seen = new Set<string>();
  const maxK = Math.min(4, size);
  for (const p of placements) {
    for (let k = 2; k <= maxK; k++) {
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const ox = p.x - i;
          const oy = p.y - j;
          if (ox < 0 || oy < 0 || ox + k > size || oy + k > size) continue;
          const id = `${ox},${oy},${k}`;
          if (seen.has(id)) continue;
          seen.add(id);

          let gaps = 0;
          let blocked = false;
          for (let dy = 0; dy < k && !blocked; dy++) {
            for (let dx = 0; dx < k; dx++) {
              if (shape.blocked.has(cellKey(ox + dx, oy + dy))) {
                blocked = true;
                break;
              }
              if (!filled(ox + dx, oy + dy)) gaps++;
            }
          }

          if (!blocked && gaps === 1) penalty += w.nearBlock * k * k;
        }
      }
    }
  }

  // Words left with a square to grow into: one tile collects the whole run.
  const walked = new Set<string>();
  for (const p of placements) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      let sx = p.x;
      let sy = p.y;
      while (filled(sx - dx, sy - dy)) {
        sx -= dx;
        sy -= dy;
      }

      const id = `${dx},${dy}:${sx},${sy}`;
      if (walked.has(id)) continue;
      walked.add(id);

      let length = 0;
      let ex = sx;
      let ey = sy;
      while (filled(ex, ey)) {
        length++;
        ex += dx;
        ey += dy;
      }
      if (length < 2) continue;

      const ends = (open(sx - dx, sy - dy) ? 1 : 0) + (open(ex, ey) ? 1 : 0);
      penalty += w.openRun * length * ends;
    }
  }

  // Tiles this move leaves able to be built on, for a stacking bonus.
  for (const p of placements) {
    const depth = (before.get(cellKey(p.x, p.y))?.stacked ?? 0) + 1;
    if (depth < STACK_CAP) penalty += w.stackable;
  }

  return penalty;
}
```

- [ ] **Step 4: Wire it into `rank`**

Extend `MoveOptions` in `shared/sim/bot.ts`:

```ts
/**
 * How heavily to weigh what a move leaves behind. `false` is the greedy
 * player: most points now, whatever it opens up.
 */
exposure?: Partial<ExposureWeights> | false;
```

After the merge in Task 7's Step 5, and before the sort:

```ts
if (options.exposure !== false) {
  for (const move of merged) {
    move.value = move.score - exposure(board, move.placements, shape, size,
      options.exposure ?? {});
  }
}
merged.sort((a, b) => b.value - a.value);
```

The lookahead block that follows still subtracts into `value`, so the two
stack: a variant may run both and compare.

- [ ] **Step 5: Run everything**

Run: `npx vitest run --project engine && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Check the cheap heuristic against the expensive truth**

This is the validation the spec asks for. Add a variant to `VARIANTS` in
`scripts/simulate.ts` that runs lookahead at weight 0.5, and compare its
squares-donated behaviour against the exposure-only default over 20 games. If
exposure is doing its job, the two should give up materially fewer squares
than a greedy bot, and be closer to each other than either is to greedy.

Record what you find. If exposure barely moves the numbers, the weights are
wrong — tune `nearBlock` upward first, since it is the dominant term.

- [ ] **Step 7: Commit**

```bash
git add shared/sim/judgement.ts shared/sim/judgement.test.ts shared/sim/bot.ts
git commit -m "feat(bot): weigh what a move leaves for the next player"
```

---

## Task 9: Blanks — offered where they pay, spent at a price

**Files:**
- Modify: `shared/sim/bot.ts` (drop the two-pass rule, add the reserve price)
- Modify: `shared/sim/judgement.ts` (add `blankPrice`)
- Modify: `shared/sim/judgement.test.ts`
- Modify: `docs/design.md` (§4.1 is wrong about blanks)

**Interfaces:**
- Consumes: Task 8's `judgement.ts`.
- Produces: `export function blankPrice(board: Board, placements: readonly Placement[], reserve: number): number`

- [ ] **Step 1: Correct the design doc**

`docs/design.md` §4.1 says:

> **Blanks are worth nothing**, wherever they sit — they still complete words
> and squares, they just contribute no letter to the score.

`shared/engine/score.ts` disagrees and is the authority — `scoreCells` counts
every occupied cell, and its comment records the change: *"A blank used to
score nothing... It pays now."* Replace that paragraph with:

```markdown
**Blanks score like any other letter.** They used to score nothing, which made
a blank a cheap way to fill a square rather than a letter you were glad to
have. The restraint is elsewhere: a blank may not be the tile that fills a
stack (§4.6), so it cannot end an argument over a square that it could not
otherwise win. At `STACK_CAP` 2 that means a blank never lands on another
tile at all.
```

Everything in this task depends on that being true, so fix the doc first.

- [ ] **Step 2: Write the failing test**

Add to `shared/sim/judgement.test.ts`:

```ts
import { blankPrice } from "./judgement";
import { GAME } from "../config";

describe("the price of a blank", () => {
  const spent = [{ x: 7, y: 7, letter: "E", isBlank: true }];

  test("costs nothing when no blank is spent", () => {
    expect(blankPrice(makeBoard([]), [at(7, 7, "E")], 8)).toBe(0);
  });

  test("is dear early, when most of the game is still to come", () => {
    expect(blankPrice(makeBoard([]), spent, 8)).toBeCloseTo(8);
  });

  test("falls to nothing as the board fills", () => {
    // A blank still in hand when the game ends is worth exactly zero, so its
    // reserve price has to reach zero with it.
    const nearlyDone = makeBoard(
      Array.from({ length: GAME.endThreshold }, (_, i) => at(i % 15, Math.floor(i / 15), "A")),
    );
    expect(blankPrice(nearlyDone, spent, 8)).toBe(0);
  });

  test("charges for each blank spent", () => {
    const two = [
      { x: 7, y: 7, letter: "E", isBlank: true },
      { x: 8, y: 7, letter: "M", isBlank: true },
    ];
    expect(blankPrice(makeBoard([]), two, 8)).toBeCloseTo(16);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --project engine shared/sim/judgement.test.ts`
Expected: FAIL — `blankPrice` is not exported.

- [ ] **Step 4: Add `blankPrice`**

In `shared/sim/judgement.ts`:

```ts
import { GAME } from "../config.js";

/** What a blank is worth keeping, so spending one has to beat it. */
export const DEFAULT_BLANK_RESERVE = 8;

/**
 * What spending a blank costs beyond the tiles it lays.
 *
 * The old rule spent a blank only when nothing else could be played at all,
 * which is not restraint but paralysis: a blank that closes a 3x3 is worth
 * nine points and was never once spent on one. A price says the same thing
 * properly -- hold it while something better is still likely to come along.
 *
 * The price falls as the board fills, because the chance of that something
 * falls with it. A blank still in hand when the game ends is worth nothing,
 * so its price has to reach nothing first. The default reserve is about what
 * closing a 2x2 pays, so early on a blank is spent for something
 * square-shaped or not at all.
 */
export function blankPrice(
  board: Board,
  placements: readonly Placement[],
  reserve: number = DEFAULT_BLANK_RESERVE,
): number {
  const spent = placements.filter((p) => p.isBlank).length;
  if (spent === 0) return 0;

  const left = Math.max(0, GAME.endThreshold - board.size);
  return reserve * (left / GAME.endThreshold) * spent;
}
```

- [ ] **Step 5: Retire the two-pass rule**

In `shared/sim/bot.ts`, `bestMove` currently searches with `blanks: 0` and
only searches again with blanks if that found nothing. Replace the body with a
single search — the price now decides, not the ordering:

```ts
export function bestMove(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  words: WordIndex,
  shape: BoardShape,
  size: number,
  options: MoveOptions = {},
): Move | null {
  const scoreOf = options.value ?? ((after, p, before) => scoreTurn(after, p, { before }).total);
  return rank(board, hand, dictionary, words, shape, size, scoreOf, options)[0] ?? null;
}
```

Note this also fixes `bestMove`'s default value function, which was
`(b, p) => scoreTurn(b, p).total` — no `before`, the same blind spot Task 6
fixed in the simulator.

Extend `MoveOptions`:

```ts
/** What a blank must beat to be worth spending. `false` never spends one. */
blanks?: { reserve: number } | false;
```

and charge it alongside exposure in `rank`:

```ts
for (const move of merged) {
  const penalty =
    (options.exposure === false ? 0 : exposure(board, move.placements, shape, size,
      options.exposure ?? {})) +
    (options.blanks === false
      ? Number.POSITIVE_INFINITY * (move.placements.some((p) => p.isBlank) ? 1 : 0)
      : blankPrice(board, move.placements, options.blanks?.reserve));
  move.value = move.score - penalty;
}
```

Guard the `false` case properly rather than with an infinity that can produce
`NaN` when no blank is spent — write it as:

```ts
const usesBlank = move.placements.some((p) => p.isBlank);
if (options.blanks === false && usesBlank) {
  move.value = Number.NEGATIVE_INFINITY;
  continue;
}
```

then filter out `-Infinity` moves before sorting.

- [ ] **Step 6: Restrict where blanks are generated**

Leaving the general search free to use blanks makes every word a candidate for
every span — `components` sets `rackPool` to every word of the length and
skips the letter-mask filter when `hand.blanks > 0`. Chaining would multiply
that. So `components` takes blanks out of the hand it searches with:

```ts
// components(): the general search never spends a blank. Blanks reach the
// board through the block solver, which is shortlisted and can afford them,
// and through the targeted pass below.
const tilesOnly = { letters: hand.letters, blanks: 0 };
```

and `rank` adds a targeted pass. Add to `shared/sim/blocks.ts`, which already
knows how to find the cells worth trying:

```ts
/**
 * Single-tile blank plays, where a blank is worth what it costs.
 *
 * A blank in the general search makes every word a candidate for every span,
 * which is why it used to be a last resort. But there is a short list of
 * squares where one tile plainly pays -- the last gap in a block -- and
 * twenty-six letters against a handful of squares is nothing. The price in
 * `blankPrice` decides whether any of them is worth taking.
 */
export function blankMoves(
  board: Board,
  hand: Hand,
  dictionary: Dictionary,
  shape: BoardShape,
  size: number,
  scoreOf: ValueFn,
  options: { maxK?: number; maxBlocks?: number } = {},
): Move[] {
  if (hand.blanks === 0) return [];

  const bounds = { width: size, height: size, blocked: shape.blocked, centre: shape.centre };
  const found: Move[] = [];
  const seen = new Set<string>();

  // A block with exactly one gap names the square directly.
  const gaps = candidateBlocks(board, shape, size, 1, options.maxK ?? 3)
    .slice(0, options.maxBlocks ?? 12)
    .filter((block) => block.empties.length === 1)
    .map((block) => block.empties[0]!);

  for (const { x, y } of gaps) {
    const priorStack = board.get(cellKey(x, y))?.stacked ?? 0;
    if (priorStack + 1 >= STACK_CAP && priorStack > 0) continue;

    for (const letter of ALPHABET) {
      const placements = [{ x, y, letter, isBlank: true }];
      const key = moveKey(placements);
      if (seen.has(key)) continue;
      seen.add(key);

      if (!validateTurn(board, placements, dictionary, bounds).ok) continue;

      const after = applyPlacements(board, placements);
      const score = scoreOf(after, placements, board);
      found.push({ placements, score, value: score });
    }
  }

  return found;
}
```

Merge its results in `rank` the same way Task 7 merged `blockMoves`, using
`moveKey` to drop what the other stages already found.

`blockMoves` keeps the full hand, blanks included, as written in Task 7 — the
solver is where a blank does its real work, closing a square the rack could
not spell alone.

Add a knob for the full search so the simulator can measure what the targeting
misses:

```ts
/** Let the general search spend blanks too. Slow; for measurement. */
blanksEverywhere?: boolean;
```

- [ ] **Step 7: Test the behaviour, not just the arithmetic**

Add to `shared/sim/bot.test.ts`:

```ts
test("spends a blank to close a square, and holds it for a cheap word", () => {
  const near = makeBoard([
    { x: 7, y: 7, letter: "A", isBlank: false },
    { x: 8, y: 7, letter: "T", isBlank: false },
    { x: 7, y: 8, letter: "T", isBlank: false },
  ]);

  const closing = bestMove(near, { letters: [], blanks: 1 }, dictionary, words, shape, 15);
  expect(closing!.placements.some((p) => p.isBlank)).toBe(true);

  // On a bare board there is nothing worth a blank; a tile play wins instead.
  const opening = bestMove(makeBoard([]), { letters: ["C", "A", "T"], blanks: 1 },
    dictionary, words, shape, 15);
  expect(opening!.placements.some((p) => p.isBlank)).toBe(false);
});
```

You may need to extend the test file's `WORDS` list so the 2x2 in the first
case actually spells something in both directions.

- [ ] **Step 8: Run everything**

Run: `npx vitest run --project engine && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add shared/sim/judgement.ts shared/sim/judgement.test.ts shared/sim/bot.ts \
        shared/sim/components.ts shared/sim/bot.test.ts docs/design.md
git commit -m "feat(bot): a blank has a price rather than a last resort"
```

---
## Task 10: Pay for the heavier search with cores

The bot now does several times the work per turn. The simulator plays
thousands of games and is the only way a rules change gets argued with
numbers, so it has to stay usable. Games are independent; the machine has
cores standing idle.

**Files:**
- Create: `scripts/sim-worker.ts`
- Modify: `scripts/simulate.ts`

**Interfaces:**
- Consumes: `playGame` from `shared/sim/game.ts` (unchanged).
- Produces: a worker protocol — in `{ variant: Variant; players: number; seed: number }`, out `{ index: number; result: GameResult }`.

- [ ] **Step 1: Write the worker**

Create `scripts/sim-worker.ts`:

```ts
/**
 * One game, played off the main thread.
 *
 * The dictionary and its index are built once per worker and reused for every
 * game that worker is given -- building them per game would cost more than
 * the games do.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";
import { makeDictionary } from "../shared/engine/dictionary.ts";
import { indexWords } from "../shared/sim/bot.ts";
import { playGame } from "../shared/sim/game.ts";
import type { Variant } from "../shared/sim/variants.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const words: string[] = JSON.parse(
  readFileSync(join(ROOT, "shared", "data", "words.json"), "utf8"),
);
const dictionary = makeDictionary(words);
const index = indexWords(words, 7);

/** Deterministic, so two variants meet the same draws. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

parentPort!.on("message", (task: { variant: Variant; players: number; index: number }) => {
  const result = playGame(task.variant, task.players, dictionary, index,
    seeded(task.index + 1));
  parentPort!.postMessage({ index: task.index, result });
});
```

**The seed is `task.index + 1`, exactly as the serial loop had it.** The
simulator's whole comparative method rests on every variant meeting the same
bags — the output header says so. Partition by game index, never by variant.

- [ ] **Step 2: Write the pool**

In `scripts/simulate.ts`, add above the variant loop:

```ts
import { cpus } from "node:os";
import { Worker } from "node:worker_threads";

const WORKER = new URL("./sim-worker.ts", import.meta.url);

/**
 * A pool of workers, kept alive across variants.
 *
 * Starting one per variant would pay to build the dictionary six times over.
 */
function makePool(size: number) {
  // tsx registers its loader for workers through execArgv; without this the
  // worker cannot import TypeScript.
  const workers = Array.from({ length: size }, () =>
    new Worker(WORKER, { execArgv: ["--import", "tsx"] }));

  const play = (variant: Variant, players: number, count: number) =>
    new Promise<GameResult[]>((resolve, reject) => {
      const results: GameResult[] = new Array(count);
      let next = 0;
      let done = 0;

      const give = (worker: Worker) => {
        if (next >= count) return;
        worker.postMessage({ variant, players, index: next++ });
      };

      for (const worker of workers) {
        worker.removeAllListeners("message");
        worker.removeAllListeners("error");
        worker.on("message", ({ index, result }: { index: number; result: GameResult }) => {
          results[index] = result;
          if (++done === count) resolve(results);
          else give(worker);
        });
        worker.on("error", reject);
        give(worker);
      }
    });

  return { play, close: () => Promise.all(workers.map((w) => w.terminate())) };
}
```

- [ ] **Step 3: Use it**

Replace the serial inner loop:

```ts
const pool = makePool(Math.min(cpus().length, games));

for (const variant of VARIANTS) {
  const started = Date.now();
  const results = await pool.play(variant, players, games);
  // ... everything downstream unchanged
}

await pool.close();
```

The file is an ESM module run by `tsx`, so top-level `await` is available.
Keep the loop over variants serial — per-variant timing stays meaningful, the
pool is reused, and games are where the parallelism is.

- [ ] **Step 4: Prove the results did not change**

This is the step that matters. Determinism is the whole contract.

```bash
git stash
npx tsx scripts/simulate.ts 20 2 > /tmp/serial.txt
git stash pop
npx tsx scripts/simulate.ts 20 2 > /tmp/parallel.txt
diff <(sed 's/[0-9.]*│ *$//' /tmp/serial.txt) <(sed 's/[0-9.]*│ *$//' /tmp/parallel.txt)
```

Every column except `secs` must be identical. If any differ, the seeding is
wrong — check that the worker seeds on the game index and nothing else.

- [ ] **Step 5: Record the speedup**

```bash
time npx tsx scripts/simulate.ts 40 2
```

Compare against the serial number from Task 7. Expect roughly the core count,
less the cost of starting workers.

- [ ] **Step 6: Commit**

```bash
git add scripts/sim-worker.ts scripts/simulate.ts
git commit -m "perf(sim): play the games across every core

40 games: <before>s -> <after>s. Columns identical to the serial run."
```

---

## Task 11: Wire the live bot up, and measure what changed

Everything so far lands in `shared/`. `convex/bots.ts` still calls `rank` with
the old value callback and no options.

**Files:**
- Modify: `convex/bots.ts`
- Modify: `docs/design.md` (the balance numbers this invalidates)

**Interfaces:**
- Consumes: everything.
- Produces: nothing new.

- [ ] **Step 1: Update the call**

In `convex/bots.ts`, `chooseMove` currently passes
`(b, p) => scoreTurn(b, p, { before: board }).total` and `{}`. The callback
signature changed in Task 6:

```ts
const moves = rank(
  board,
  { letters: player.letters, blanks: player.blanks ?? 0 },
  dictionary,
  words,
  shape,
  game.boardSize,
  (after, placements, before) => scoreTurn(after, placements, { before }).total,
  {},
);
```

Check whether `players` documents carry a blank count — `shared/sim/game.ts`
gives each player `blanks: 3` and `BLANKS_PER_GAME` is 3, but
`convex/bots.ts` passes `blanks: 0` today. If the schema has no field for it,
leave `blanks: 0` and note it: **the live bot will never spend a blank until
the schema carries one**, which is a separate piece of work.

- [ ] **Step 2: Confirm the authoritative check is still authoritative**

`chooseMove` re-validates the chosen move's words against the `words` table.
That must stay, and it must **not** be given the `connected: true` shortcut
from Task 4 — that flag exists only inside `components`, for candidates the
search has already established touch the mass.

Read the `allWords` loop and confirm nothing bypasses it. A chained or
block-solved turn forms more words than a single-span one, so this check now
does more work per move; the `take(512)` on tiles and the loop over
`new Set(words)` are both fine at that scale.

- [ ] **Step 3: Measure a live turn**

The bot runs inside a Convex mutation, so its cost is real. Add a temporary
timing log around the `rank` call, run a game against a bot locally
(`npm run dev`), and read the Convex logs.

Budget: there is already a deliberate `THINKING_MS = 1600` pause before the
turn, so anything under about a second is invisible to the player. If `rank`
comes in slower, turn the knobs down **for the live bot only** — start with
`chain: { depth: 2, breadth: 4 }`, then `squares: { maxK: 3, maxBlocks: 8 }`.
Do not change the defaults in `shared/`; the simulator should keep measuring
the strongest bot.

Remove the timing log before committing.

- [ ] **Step 4: Play against it**

Start a game against each difficulty and confirm by eye:

- `hard` builds squares and does not routinely leave blocks one tile short.
- `easy` plays visibly weaker moves that are still sensible words, not
  nonsense — the band picks a worse move, never an illegal or silly one.
- No turn takes visibly longer than the thinking pause.

- [ ] **Step 5: Re-measure the balance, and say so in the docs**

```bash
npx tsx scripts/simulate.ts 200 2
```

Record: seat 0 / seat 1 win%, mean score, turns, `3x3+` per game, best turn.

Then add to `docs/design.md`, at the end of §6:

```markdown
**These numbers were re-measured in September 2026**, after the bot learned to
chain plays and build squares deliberately. Everything measured before that
was measured against a player that could only lay one word along one line, and
so almost never completed a 3x3 — 0.00–0.15 per game across 120 games. Any
balance conclusion drawn from the older figures is worth re-checking against
these.
```

Fill in the actual figures alongside.

- [ ] **Step 6: Full verification**

```bash
npm test
```

Expected: PASS, every project — `engine`, `convex`, `ui`, `hooks`. Then check
the scoped lint count is still 43 or fewer (see Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add convex/bots.ts docs/design.md
git commit -m "feat(bot): the live bot plays the full move space"
```

---

## Out of scope

Named here so they are decisions rather than oversights:

- **Endgame play.** No tile counting, no blocking to run out the clock.
- **Opponent rack inference.** The lookahead stand-in rack stays a stand-in;
  the bot should not see the opponent's letters.
- **Blanks for the live bot** if the `players` schema has no blank count
  (Task 11, Step 1). That is a schema and game-rules change, not bot work.
- **Words longer than seven letters.** The spec names these among the turns
  the bot cannot reach, and no task here fixes it: the index is built as
  `indexWords(words.filter((w) => w.length <= 7), 7)` in both `convex/bots.ts`
  and `scripts/simulate.ts`, and raising the cap grows the index and every
  span scan behind it. Chaining recovers part of what is lost — an eight-letter
  word is often reachable as a shorter word plus an extension in the same turn
  — so measure with `maxLength` raised before paying for it. `MoveOptions`
  already carries the knob.
- Dictionary and board-shape changes.

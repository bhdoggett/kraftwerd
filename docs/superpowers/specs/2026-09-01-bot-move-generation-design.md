# Bot move generation — design

Date: 2026-09-01

## Problem

The bot plays one dictionary word along one straight span per turn. That is
the whole of its move space: `rank()` enumerates spans, matches words against
them, fits, validates, scores.

The rules allow far more. A turn is any set of placements (design.md §3) —
there is no collinearity requirement. The only constraints are that every
maximal run of length >= 2 is a word and that the board stays one
orthogonally-connected mass. So every one of these is legal and unreachable
by the current search:

- Placements in more than one line: L-shapes, scattered tiles, anything that
  closes a k x k block whose missing cells are not collinear.
- Chaining — a word here and a tile there in the same turn, each scoring.
- Deliberate construction of a 3x3 word square.
- Words longer than 7 letters, and extensions past 7 (span length cap).

Squares pay k^2 and are the largest scoring lever in the game. The bot closes
one only by accident, when the gap happens to fall along a single line.

## Evidence

`npx tsx scripts/simulate.ts 20 2` — 120 games (20 x 6 variants), 254s.

- ~2.1s per game, ~20 turns per game, so **~100ms per bot turn** today.
- **`3x3+` column: 0.00–0.15 per game.** Roughly nine 3x3s across 120 games;
  most variants scored zero.
- Best turn averages 12–14.

The game's headline scoring mechanism is dormant because the search cannot
reach it.

## Decisions

1. **Full legal move space.** Bots may play anywhere the rules allow,
   including deliberately building 3x3s. One engine; difficulty is the only
   dial.
2. **Difficulty by score fraction, not rank.** Rank is a weak proxy — in a
   400-move list, #1 and #40 may both score 21, so rank bands would make easy
   and hard play near-identically while claiming to differ.
3. **Heavy search everywhere; pay for the sim with parallelism.** Rejected
   giving the sim a cheaper setting: it would then measure a weaker bot than
   the one people play, which undermines the sim's purpose. Rationale from the
   user: *"sims are useless if the bots aren't capable of making moves like
   people."*
4. **Static exposure penalty as the default judgment; full lookahead as a sim
   knob** to validate the cheap version against the expensive one.
5. **Blanks priced, not hoarded.** Replaces the current last-resort rule.

## Architecture

Three generation stages feeding one ranked list. Judgment (exposure, blank
price) and selection (difficulty bands) sit on top and are agnostic to how a
move was generated — so they are independently shippable, and should be built
first as the scaffolding that makes generator work measurable.

### §1 The Move contract

```ts
export interface Move {
  placements: Placement[];
  /** Points the turn actually scores, by the rules. */
  score: number;
  /** score minus exposure and blank price — what ranking and banding use. */
  value: number;
}
```

`score` and `value` must be distinct. Today `lookahead` subtracts its penalty
into `score`, conflating what a move pays with what the bot thinks of it. The
sim reports `score`; ranking and banding read `value`.

Dedupe key: placements sorted by `(x, y)`, joined as `x,y,letter,isBlank`.
Chaining and the square solver will independently find some of the same turns.

### §2 Stage 1 — component search

Today's `rank` body extracted as `components(board, hand, …) -> Move[]`.
Logic unchanged.

**Prerequisite, load-bearing:** it must get faster before chaining can exist.
It currently walks every span of every length across the board and checks
`touchesLive` after reading the span. Invert it — enumerate anchors (live
cells) first, then only spans through them.

At today's ~100ms, depth-2 chaining at breadth 8 costs 9 component searches
≈ 0.9s/turn; depth 3 is ~7s. Chaining is unaffordable until this lands, so it
is step one of the plan.

### §3 Stage 2 — chaining

Recursive: apply a component to a provisional board, re-search with the
remaining rack, recurse to a depth cap. Each recursive step is a legal play in
its own right, which keeps pruning strong and validation cheap.

**Chaining accumulates placements and scores once at the end, against the
turn's starting board — never incrementally.** Two components that each
complete nothing can together complete a 2x2, and square bonuses are
super-additive. Per-step scoring would miss precisely the thing this exists
for. It also keeps `before` correct for stack depth and for "was this block
already complete."

Defaults: depth 2, breadth 6. Both knobs.

### §4 Stage 3 — square solver

For turns chaining structurally cannot reach: placements that are only legal
together, i.e. the deliberate 3x3.

Shortlist k x k blocks, k = 2..4, where the block is not already full, its
empty cells number no more than the rack, and it touches the mass. A 4x4 with
9 tiles already down is reachable late game; the empty-count filter makes
including it free.

Solve by assigning rack letters to empty cells, propagating through the
`"position:letter" -> words` posting lists already built by `indexWords`.
Intersecting posting lists as letters are assigned is the right propagation
and prunes hard.

**Subtlety:** a block's rows and columns do not stop at the block. A 2x2 whose
row extends left into existing tiles forms a longer word. The solver resolves
each row and column to its full maximal run and requires *that* to be a word,
not the k-letter fragment.

### §4a Blanks in generation

The existing two-pass rule (tiles first, blanks only if nothing plays) exists
for a real reason: `anyLetter` sets `rackPool` to every word of that length
and skips the mask prefilter, so a blank in hand makes every word a candidate
for every span. That explodes, and chaining multiplies it.

So: no general blank search. Blanks are offered only where they demonstrably
pay.

- **To the square solver, always.** Already shortlisted to a handful of
  blocks; a blank is a cell with no rack constraint, widening a bounded search
  rather than an unbounded one. This is the case that matters most and the
  cheap one.
- **To a targeted component pass.** Cheap scan for cells where one tile would
  close a block or extend a long run; try a blank at those cells only.
- **Full blank search behind a knob**, for the sim to measure what the
  targeting misses.

**Placement constraint.** `legality.ts` reads:

```ts
if (p.isBlank && priorStack + 1 >= STACK_CAP && priorStack > 0)
```

At `STACK_CAP = 2` this reduces to `priorStack >= 1`, so today a blank can
never land on top of a tile — blanks go on empty cells only. But the predicate
means *"a blank may not be the tile that closes the stack"*; at
`STACK_CAP = 3` blanks could stack onto depth-1 squares again. **The generator
must prune on the predicate, not on a hardcoded "empty cells only"**, or the
rule silently changes meaning the next time that constant moves.

### §5 Static exposure penalty

Computed on the board a move leaves, once per candidate:

- **Near-complete blocks.** Any k x k now exactly one cell short — the
  opponent collects k^2 for one tile. Penalty proportional to k^2. Dominant
  term; the one people actually see.
- **Open runs.** Maximal runs adjacent to an empty cell — one tile collects
  the run's whole length (design.md §4.1, `RISE` -> `RISEN`). Penalty
  proportional to run length.
- **Stack invitations.** Squares at `stacked: 1` reachable by the opponent,
  worth a depth-2 bonus. Small; include at low weight and let the sim decide
  whether it earns its place.

Starting weights, to be tuned rather than trusted: near-complete blocks 0.6
(so a donated 2x2 costs ~2.4 against a move), open runs 0.15 per letter, stack
invitations 0.1. These exist so the first sim run has something to measure;
they are not claims.

Cost stays near-free by examining only blocks and runs touching this move's
placements — the locality trick `newSquareBlocks` already uses. Whole-board
recomputation per candidate would be ruinous.

Weights tuned in the sim against full lookahead as ground truth: run both,
correlate the rankings. That is both the validation of the cheap heuristic and
how we learn whether it is good enough.

### §5a Blank reserve price

Replaces "last resort" with a price. Each blank carries a reserve value `R` —
what its best expected future use is worth — charged against any move spending
it:

```
value = score − exposure − R * blanksUsed
```

`R` decays toward the endgame. `BLANKS_PER_GAME` is 3 and the game ends at
`GAME.endThreshold` (50) tiles on the board; a blank still in hand when that
fires is worth zero. So `R` scales with how much game is left — high early,
near zero late — which makes the bot hoard sensibly and then dump.

Starting form, to be tuned: `R = R0 * (tilesRemaining / GAME.endThreshold)`
with `R0 = 8` — roughly the value of closing a 2x2 plus its letters, so early
on a blank is spent only for something square-shaped. As with the exposure
weights, a starting point for measurement, not a claim.

Strictly better than the two-pass rule: a blank is spent exactly when the move
clears the price, rather than only when nothing else exists.

### §6 Difficulty bands

```ts
const BANDS: Record<Difficulty, [number, number]> = {
  hard:   [0.85, 1.00],
  medium: [0.55, 0.85],
  easy:   [0.30, 0.55],
};
```

Take best value `V*`, keep moves whose value lies in `[lo*V*, hi*V*]`, then
sample within the band by the existing `exp(-i / tau)` weighting over position
*within the band* — reusing `chooseRanked`'s curve rather than inventing a
second one, with a single shared tau (start at 2.5). So the band decides how
good a move the bot is willing to play, and tau decides how it picks among
equals inside that band. `TAU` as a per-difficulty table goes away; the bands
replace it.

Edge cases, all of which need explicit handling:

- **Band empty** (few legal moves, or a sparse value spread): widen upward to
  the nearest available move. Never downward, never fail to play.
- **`V* <= 0`** (possible once exposure bites and every move is bad):
  fractions of a negative number invert the ordering. Fall back to rank
  position.
- `convex/bots.ts` `inPreferredOrder` draws without replacement so a
  dictionary rejection falls through sensibly. Keep that shape; re-band the
  remainder.

### §7 Sim parallelism

`scripts/simulate.ts` gets a `worker_threads` pool: one game per task,
`os.cpus().length` workers, aggregation in the parent. Games are independent.

**Constraint to preserve:** the output header reads *"identical draws across
variants"*. The sim's comparative method rests on every variant seeing the
same bags. **Partition by game index, not by variant**, and derive each game's
bag from a seed keyed on that index. Getting this wrong makes every balance
number the sim has produced incomparable with the new ones.

### §8 Testing

**Primary safety net: a property test that every move `rank()` returns passes
`validateTurn`**, over randomly generated boards and racks. The move space is
about to grow substantially and generating an *illegal* move is the main risk
— chaining and the solver both construct turns no single-span search would
propose.

Also:

- A known two-component chain.
- The solver building a 3x3 against the `ACE`/`CAM`/`EMU` fixture already in
  `integration.test.ts`.
- Dedupe.
- Band selection, including all three edge cases above.
- Blank pricing: a blank spent to close a 3x3, hoarded when the move is cheap,
  dumped near the end threshold.
- Existing `bot.test.ts` passes unchanged.
- A perf assertion pinning the component search under budget, so the §2
  speedup cannot silently regress.

### §9 Knobs

`MoveOptions` gains `chain: {depth, breadth}`, `squares: {maxK, maxBlocks}`,
`exposure: {weights}`, `blanks: {reserve, full}`. All on by default in live
play. Sim variants toggle them to measure what each stage is worth, including
turning everything off to reproduce today's bot as a baseline.

## Required corrections outside the bot

**`docs/design.md` §4.1 is stale.** It states *"Blanks are worth nothing."*
`score.ts` disagrees — its comment reads *"A blank used to score nothing... It
pays now"*, and `scoreCells` counts every occupied cell regardless of blank
status. The only remaining blank restriction is `blank-on-stack`. The blank
design in §4a/§5a depends on blanks scoring, so the doc must be corrected.

## Known consequences

**The sim's balance findings will move.** Bots that build squares and defend
them produce different first-player advantage, game lengths, and `3x3+`
counts. Every number currently in design.md was measured against a weaker
player. That is the point of the exercise, but rules conclusions drawn from
the old numbers deserve re-checking once this lands.

## Out of scope

- Endgame-specific play (tile counting, blocking to run the clock).
- Opponent rack inference. The lookahead stand-in rack stays a stand-in.
- Dictionary or board-shape changes.

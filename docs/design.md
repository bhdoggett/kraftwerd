# kraftwerd — Design Spec (draft)

Working name: **kraftwerd**.

Async turn-based word-square builder. Convex + React/Vite. Multi-account.

Status: design recovered from pre-rename session. Locked decisions below are
answered; **§9 Open** are not.

---

## 1. Core loop

**2–4 players**, turn order fixed. Players share one large finite board. On your turn you place any number of
tiles from your rack anywhere on the board. Every contiguous run of tiles you
create or touch must spell a valid word. You score 1 point per tile you
placed, plus a bonus for every filled square block your placement completes —
including squares built mostly from your opponent's tiles.

The game is not Scrabble. There are no letter values, no premium squares, no
fixed board, no connectivity requirement, and the central mechanic (square
construction) does not exist in Scrabble. IP exposure is limited to the name.

## 2. Board

- **15×15 and open.** Odd-sided so there is a true centre.
- **Blocked squares are supported but not dealt.** The hand-drawn layouts in
  `shared/boards.ts` and the rules that enforce them are kept — a game already
  dealt one still plays — but new games get an open board while the simpler
  shape is tried out.
- **The opening word must cover the centre square.** Everything after it is
  anchored by connectivity (§3) back to that first word.
- **Layouts live in `shared/boards.ts`, written as pictures** — `#` blocked,
  `.` open — so a new one is drawn by editing the art rather than listing
  coordinates. Each game is dealt one at random.
- `boards.test.ts` holds every layout to the rules: square and odd-sided,
  rotationally symmetric, centre open and its neighbours open, 5–20% blocked,
  and every open square reachable from every other. That last one matters —
  an unreachable pocket is a region nobody could ever play in.
- **The whole board is drawn.** Blocked squares can only be planned around if
  they are visible, and a finite board's edges matter before you reach them.

*This replaced an unbounded board.* Rendering only the played area made size
irrelevant, which quietly removed the space competition a finite board was
chosen for in the first place. Obstacles bring back the spatial puzzle: they
break up the open plane, and a 2×2 cannot span one.

## 3. Placement legality

A turn is legal iff **all** hold:

1. Every placed tile lands on an empty cell.
2. Placed tiles come from the player's rack (§5).
3. After placement, **every maximal contiguous run of length ≥ 2** — both
   horizontal and vertical, anywhere on the board — is in the dictionary.
4. After placement, **every tile on the board forms a single orthogonally-
   connected mass.**

Rule 3 is the crossword rule, applied in both directions with no exceptions.
Only runs intersecting placed tiles can have changed, so validation checks
those runs, not the whole board.

**Connectivity (rule 4).** The opening play establishes the mass; from then
on every play by every player must touch it. Diagonal contact does not count.
There is one shared structure, so all 2–4 players are in each other's way from
move two onward, and "completer takes it" (§4.4) is live every turn.

*This reverses an earlier "free islands" decision.* Free islands broke the
game: since every tile scores 1 point regardless, word validity contributed no
points at all, so scattering 8 unconnected tiles scored a guaranteed 8 — equal
to a 2×2 word square — with no dictionary constraint whatsoever. Connectivity
closes that hole for free: a tile touching the mass is adjacent to a tile,
therefore sits in a run of ≥2, therefore must spell something.

**One-letter runs.** A tile with no neighbours must itself be a word — so `A`
and `I` only. This is reachable *only* on the opening play, since rule 4 gives
every later tile a neighbour. Note that SCOWL lists all 26 letters as
one-letter words (a spellchecker artifact); the build script strips all but
A and I.

**Consequence for 3×3s.** Rule 4 kills the trick of laying rows 1 and 3 with a
gap and filling the middle later — row 3 would touch nothing. A 3×3 is 9 tiles
against a rack of 8, so it always spans two turns, and the 8-tile intermediate
state must itself be fully legal: the partial bottom row has to be a real word
too. Verified end-to-end in `integration.test.ts` with `ACE/CAM/EMU`, which
pays 20 on the first turn and 14 on the second.

Consequence worth internalizing: a 2×2 block is four 2-letter words (2 across,
2 down). A 3×3 is six 3-letter words. This is a genuine word square and it is
hard — which is what justifies the payouts in §4.

```
  C A     across: CA, AT
  A T     down:   CA, AT
```

## 4. Scoring

### 4.1 Word points

**Every letter of every word the play forms**, counting letters already on the
board. A letter in both an across and a down word counts in each, as in
Scrabble.

**Blanks are worth nothing**, wherever they sit — they still complete words and
squares, they just contribute no letter to the score.

This is what makes reading the board matter. One tile added to `RISE` scores
`RISEN` in full: five points for one tile.

*This replaced an earlier rule of 1 point per tile you placed.* Under that rule
extending an existing word was worth exactly as much as playing in empty space,
so there was no reason to look at what was already there.

**The obvious objection, and why it does not hold.** Paying for existing
letters seems to reward building a word one tile at a time, re-scoring its
length each turn. In solo play it does. Against an opponent it inverts, because
they take every other turn — and the last, longest one:

| building `ATE` | you | them |
|----------------|-----|------|
| `ATE` in one turn | 3 | 0 |
| `AT`, they add `E` | 2 | **3** |

So a word left extendable is a liability, exactly like an open corner in a 2×2.
About 77% of two-letter words in our list can be extended by appending a single
letter, so this is most of the board rather than an edge case.

### 4.2 Square bonus — nested

Every axis-aligned, fully-filled `k×k` block on the board, for `k ≥ 2`, is a
*square*. A square of size `k` is worth `k²`.

**Nested counting**: a 3×3 contains four 2×2s and one 3×3. All of them count.

| Build | Tiles | Sub-squares | Bonus | Total | Pts/tile |
|-------|-------|-------------|-------|-------|----------|
| 2×2 | 4 | 1×(2×2 @4) | 4 | **8** | 2.0 |
| 3×3 | 9 | 4×(2×2 @4) + 1×(3×3 @9) | 25 | **34** | 3.8 |
| 4×4 | 16 | 9×@4 + 4×@9 + 1×@16 | 88 | **104** | 6.5 |

Rate climbs 2.0 → 3.8 → 6.5. Big builds are worth chasing, which is correct
given a 4×4 word square is brutally hard.

### 4.3 Completion — squares score ONCE

A square scores only on the turn it first comes into existence. Without this,
a 2×2 would pay out every turn forever.

**No diff is needed.** Placements only ever *add* tiles, so a block is new iff
at least one of its cells was empty before the turn — i.e. iff it contains at
least one placed cell:

```
new squares = { filled k×k blocks containing ≥1 placed cell },  k ≥ 2
score       = Σ k²
```

Provably equivalent to `squares_after − squares_before`, but needs no board
history and no set subtraction. Enumerate candidate blocks by anchoring each
size-k block at `(px − i, py − j)` for `i, j ∈ [0, k)` around each placed cell,
dedupe by `(anchor, k)`, and keep those fully filled. `k` is bounded by
`⌊√(tiles on board)⌋`, since a k×k block needs k² tiles.

Implemented in `shared/engine/squares.ts`.

### 4.4 Completer takes it

Whoever places the final tile of a square scores the **entire** square,
regardless of who placed the other tiles.

```
opponent (o), you (Y):

  o o          o o
  o .    ->    o Y      you score: 1 tile + 4 = 5
```

This falls out of the diff rule with zero extra logic and it is the sole
source of player interaction. Leaving an open corner is dangerous. Every build
is a risk.

### 4.5 Order of operations

```
1. sum every letter of every word formed  -> word points (blanks count 0)
2. diff square sets                       -> + Σ k² for new squares
3. sum                                    -> turn score
```

An n×n block is 2n words of n letters, so the two halves of the score grow at
different rates:

| build | word points | square bonus | total |
|-------|-------------|--------------|-------|
| 2×2 | 8 | 4 | **12** |
| 3×3 | 18 | 25 | **43** |
| 4×4 | 32 | 88 | **120** |

## 5. Rack and letter generation

- Rack is **7 letters**, refilled after every play.
- **3 blanks for the whole game.** They do not refill: spending one is a
  decision about when, not something to use or waste each turn.
- Any number of your remaining blanks may go down in one turn.
- Blank is wild, assigned a letter permanently on placement.
- **No finite bag.** Letters are randomly generated per draw.

### 5.1 Distribution

*This replaced an earlier corpus-derived distribution* (letter frequency
across 2–5 letter dictionary words, with a floor lifting J/Q/X/Z out of
near-zero). That approach optimized for which letters build short words in
*this* dictionary; the current one optimizes for matching real English, which
reads as fairer and is easy to check against a published source.

**Source: real English letter frequency**, the "Texts" column of the English
section at [Letter frequency (Wikipedia)](https://en.wikipedia.org/wiki/Letter_frequency)
— frequency as letters actually appear running text, not per dictionary
entry.

**J, Q, X, Z are pinned to 1 tile of 50 each**, by decision rather than by
scaling down their real frequency (which would be under 1 tile anyway at this
pool size — combined they are under 0.6% of English). Pinning them, rather
than letting the maths round them to whatever it rounds to, makes the floor a
choice on the record instead of an accident of the pool size.

**K and V round to 0 at this pool size** (0.77% and 0.98% of English,
respectively) scaled against the other 22 letters — an amount genuinely under
half a tile. Left alone that is not "rare," it is *absent*: neither letter
would ever be drawable. Both are floored to 1 tile instead, the two tiles
taken back from the most common letters (E, T) so the pool still totals 50.

*Nudged again, on top of that,* toward letters that are good at turning one
word already on the board into another by swapping a single tile — the game's
own stacking rule makes that a real, repeated decision, not just a
frequency-matching exercise. Measured directly against the dictionary: for
every letter, how many (word, position) pairs turn into a *different* valid
word if that letter is dropped in. P, M, B and D ranked far above their
weight (5th, 8th, 9th and 4th by that measure, at 1, 1, 1 and 2 tiles); H, E,
A and O ranked well below theirs (13th, 10th, 12th and 16th, at 3, 5, 4 and 3
tiles). One tile moved each way — P/M/B up, H/E/A/O down — funds the fix
without touching J/Q/X/Z, K/V, or the letters that were already well matched
to their rank (S, T, R, N stayed put; all four rank in the top 7).

Vowel share drops from 32% to 26% of the pool as a result. The floor
(`minVowels`, below) still guarantees 2 vowels every rack, but leans on that
guarantee more often now — roughly a third of racks need it to kick in,
against a little over a fifth before. Worth watching in play: this is the
lever to loosen first if racks start feeling consonant-heavy.

**Weights** (tiles out of a 50-letter pool):

```
T 4   E 4
A 3  D 3  I 3  N 3  R 3  S 3
B 2  H 2  L 2  M 2  O 2  P 2
C 1  F 1  G 1  J 1  K 1  Q 1  U 1  V 1  W 1  X 1  Y 1  Z 1
```

Every letter is drawable — nothing is suppressed to zero — and the shape
still reads as English: T and E lead, the vowels and the common consonants
sit in the middle, and J/Q/X/Z (by decision) plus K/V (by floor) share the
bottom at one tile each.

Live in `shared/data/letter-weights.json`, hand-written rather than generated
— it does not depend on the dictionary, so `scripts/build-dictionary.mjs`
leaves it alone on every rebuild.

**Vowel floor and duplicate cap are unchanged** by this — they are about how
a *rack* reads, not where the weights come from. A 7-letter rack keeps a
floor of 2 vowels (`minVowels` in `shared/config.ts`): low enough that the
blank standing in for a vowel is a real option rather than a guarantee, high
enough that a vowel-less rack stays vanishingly rare. Any single letter is
still capped at 2 copies per rack, so independent draws can never hand
someone `EEEEEEE`.

### 5.2 Dictionary

**Source: SCOWL tier 60**, via the `wordlist-english` npm package, built by
`scripts/build-dictionary.mjs` into `shared/data/words.json` (76,911 words).
SCOWL's licence permits any use but requires its copyright notice travel with
the words; the build copies it to `shared/data/SCOWL-Copyright.txt`.

*This replaced tier 50 (60k words) — playtesting wanted more words available,
not fewer, and tier 60 stays short of tier 70's much longer tail of words
nobody would recognize as valid (`GRIGRI`, `CANULA`, `AXSEED`).*

An accent is stripped rather than treated as disqualifying, so a loanword
plays as the spelling any tile can actually make: `CAFE`, `CLICHE`, `ENTREE`.
SCOWL's own accented spelling is what got dropped before; the ordinary word
was never the problem.

SCOWL is a spellchecker corpus, not moderated for word-game use, so a short
hand-written list screens out identity-based slurs regardless of tier (see
`SLURS` in `scripts/build-dictionary.mjs`). It only removes words with no
everyday meaning worth keeping them for — `PADDY` and `SLOPE` stay, since
those readings are the primary, everyday one.

Measured across the tiers — the numbers that actually decide the game:

| tier | words | valid 2×2 | valid 3×3 | letters in no 2-letter word |
|------|-------|-----------|-----------|------------------------------|
| 35 | 38k | 187 | 39,595 | j k l q v z |
| 40 | 43k | 327 | 49,576 | j q v z |
| 50 | 60k | 393 | 95,481 | j q v z |
| 70 | 108k | 1,094 | 504,440 | v z |

*The 2-letter column above is stale: it predates the hand-curated `TWO_LETTER`
list in `scripts/build-dictionary.mjs`, which fixes the two-letter words at
107 regardless of tier rather than taking whatever SCOWL happens to carry at
that cut. The 2×2/3×3 counts, measured before that list existed, have not been
re-run since — treat them as directional, not current.*

Two findings from this:

- **The 2×2 is the bottleneck, not the 3×3.** Only 393 valid 2×2 squares exist
  in the whole language at tier 50, against 95,481 3×3s — 3-letter words are
  numerous enough that the combinatorics explode. The 34-point payout is far
  more reachable than the 8-point one. Do not assume the small square is the
  easy one.
- **Tier 40 is the floor.** At tier 35 the letter `L` appears in no 2-letter
  word at all, and a common rack letter that can never enter a 2×2 feels
  broken. Tier 50 chosen: recognizable vocabulary, and only J/Q/V/Z are
  2×2-dead.



**Do not use NWL, TWL, OSPD, or Collins/SOWPODS.** All are proprietary
licensed products (NASPA / Merriam-Webster / Collins), and NASPA actively
issues takedowns against word-list repositories. Whether a word list is
copyrightable at all is unsettled — facts aren't protectable under *Feist*,
but editorial selection of "valid words" is a plausible compilation claim.
Irrelevant in practice: free lists are equally good.

**Use SCOWL**, at a mid-size frequency cut. Permissive license, and tiered by
word commonality so the obscurity level is a tunable parameter rather than a
fixed property of the list. This matters more here than in most word games: a
3×3 requires six simultaneously-valid words, and if most solutions are words
no player recognizes, the mechanic reads as a lottery rather than a puzzle.

Alternative: **ENABLE** (~172k, explicit public domain) as a straight drop-in
if tiering isn't wanted.

**The 2-letter list is hand-curated** (`TWO_LETTER` in the build script), and
replaces SCOWL's entirely rather than merging with it. SCOWL is a spellchecker
lexicon and is wrong for this job in both directions: it omitted words every
word-game player expects (`QI`, `JO`, `ZA`, `XI`) while including plurals of
letter names (`CS`, `GS`, `TS`) that nobody would accept on a board.

Omitting J/Q/Z mattered most: with no two-letter word containing them, those
letters could never enter a 2×2 at all — which collided with the rare-letter
floor that had just made them more common.

| list | words | 2×2 squares | rack can build one | without a blank | dead letters |
|------|-------|-------------|--------------------|-----------------|--------------|
| SCOWL as-is | 60 | 393 | 96% | 52% | J Q V Z |
| **curated** | **105** | **2,509** | **100%** | **94%** | C V |

This makes 2×2s easy, which is a deliberate trade: a short list rejects words
players will certainly try (`TA`, `BO`, `PE`, `OK`), and being told a real word
is not a word is the most irritating failure a word game has. Only `C` and `V`
now appear in no two-letter word, so only they are barred from a 2×2.

If 2×2s ever need to be scarce again, the lever is not this list — it is the
blank. Stopping a blank from completing a square takes buildability from 94%
to 52% in one step, without ever rejecting a real word.

## 6. Game end

- Game ends when **total tiles on board ≥ 50**.
- End triggers at the **end of the round**, not immediately, so every player
  gets equal turns. Otherwise the player who crosses the threshold takes the
  last uncontested snipe.
- Highest total score wins.

## 7. Data model — implemented in `convex/schema.ts`

```
games:     status, boardSize, playerIds[], currentTurnIndex,
           tileCount, endThreshold, createdAt
tiles:     gameId, x, y, letter, isBlank, placedBy, turnNumber
           index: by_game_position (gameId, x, y)
           index: by_game (gameId)
racks:     gameId, playerId, letters[]        (private per player)
turns:     gameId, turnNumber, playerId, placements[], score, at
users:     Convex Auth
```

Notes:
- Racks must not be readable by the opponent. Enforce in the query, not the UI.
- Dictionary as a Convex table with an index on the word, or bundled and
  loaded server-side — decide on wordlist size.
- All scoring runs server-side in a mutation. The client never computes score.
- Convex mutations are deterministic/retryable; confirm the correct RNG
  approach for rack generation against `convex/_generated/ai/guidelines.md`.

## 8. Build order

1. ~~Scoring engine — run extraction, square detection, nested counting,
   turn scoring.~~ **Done.** `shared/engine/`, no Convex/React deps.
2. ~~Dictionary + placement legality (§3).~~ **Done.** SCOWL tier 50 +
   `shared/engine/legality.ts`.
3. ~~Rack generation + letter config (§5.1).~~ **Done.** `shared/engine/rack.ts`
   + `shared/config.ts`.
4. ~~Convex schema + `placeTiles` mutation wrapping the engine.~~ **Done.**
   `convex/schema.ts`, `convex/games.ts`, 13 convex-test cases.
5. ~~Board UI (render, select rack tile, place, preview score, submit).~~
   **Done.** CSS modules + design tokens, no Tailwind.
6. ~~Auth (Better Auth + Google), lobby, game list.~~ **Done** — see
   `docs/auth-setup.md` for the two manual Google steps. Turn notifications
   still outstanding.  ← current

Steps 1–3 are where the game is won or lost. The rest is plumbing.

## 9. Open

- **SCOWL cut size.** Which frequency tier. Needs playtesting.
- **N.** Tile-count threshold for game end. Needs playtesting; 400 (25% of a
  40×40) is a starting guess.

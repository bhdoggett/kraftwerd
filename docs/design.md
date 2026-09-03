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

**Blanks score like any other letter.** They used to score nothing, which made
a blank a cheap way to fill a square rather than a letter you were glad to
have. The restraint is elsewhere: a blank may not be the tile that fills a
stack (§4.6), so it cannot end an argument over a square that it could not
otherwise win. At `STACK_CAP` 2 that means a blank never lands on another
tile at all.

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
1. sum every letter of every word formed  -> word points (blanks count too)
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

### 4.6 Landing on a tile, and the stack

A placement may land on an occupied square, replacing its letter, as long as
the resulting word still checks out (`AT` → `IT`, not `AT` → `AZ`). This is
what keeps a board from ever getting stuck: every square stays reachable,
even a closed-off one, because you can always rebuild through it.

**Stack cap.** A square may hold at most `STACK_CAP` tiles over its lifetime
— two, so it can change hands once and then settles. A third attempt on a
maxed-out square is refused outright, before word or connectivity checks
even run.

**Stack bonus.** Landing on an already-occupied square pays extra, equal to
how deep the stack now runs: **+2** for the tile stacked on top, which at a
cap of two is also the last tile that square will ever take. A tile landing
on an empty square earns none of this. The bonus scales with `STACK_CAP` by
construction — raise the cap and the top bonus follows it.

```
fresh square      : 0
1st tile stacked  : +2   (the square is now full)
```

Both live in `shared/config.ts` (`STACK_CAP`) and `shared/engine/score.ts`
(`scoreTurn`'s `stackBonus`).

## 5. Rack and letter generation

- Rack is **7 letters**, refilled after every play.
- **3 blanks for the whole game.** They do not refill: spending one is a
  decision about when, not something to use or waste each turn.
- Any number of your remaining blanks may go down in one turn.
- Blank is wild, assigned a letter permanently on placement.
- **A finite bag**, shared by everyone at the table — `shared/engine/bag.ts`,
  built from the same weights that once described an endless draw. Read as a
  bag they mean what they look like: one Z exists, and once it is played it is
  gone. This is `RULES_VERSION` 2; version 1 was the endless draw, and its
  scores do not compete with these.

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

**The three paragraphs that follow describe the fifty-tile pool** this
distribution started as, and are kept because they are where the shape came
from. The bag that ships is seventy-one tiles — see "Where it stands now"
below, which is the part to trust if the two disagree.

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

Vowel share dropped from 32% to 26% of that fifty-tile pool as a result.

**Where it stands now.** The pool became a finite bag and then grew twice, and
the shipped bag is **seventy-one tiles, twenty-seven of them vowels — 38%**:

```
E 7
A 6
I 5  O 5
N 4  R 4  T 4  U 4
D 3  L 3  M 3  S 3
B 2  C 2  G 2  H 2  P 2  Y 2
F 1  J 1  K 1  Q 1  V 1  W 1  X 1  Z 1
```

A deeper bag with more to build from: E came down from nine to seven and the
letters that make words went up. U at four is deliberate — two was the meanest
thing in the bag before it, and a U you never draw makes a Q you can never
play. At seven tiles a rack that is about ten refills across a table. The vowel
floor (`minVowels`, below) is now held over rather than load-bearing — a bag
gives what it has and cannot keep drawing until a rack meets a floor — and
`shared/config.ts` puts about one hand in five short of vowels at this share.
This is `RULES_VERSION` 2.

Every letter is drawable — nothing is suppressed to zero — and the shape still
reads as English: E and A lead, the common consonants sit in the middle, and
J/Q/X/Z share the bottom at one tile each with the letters that round there.

Live in `shared/data/letter-weights.json`, hand-written rather than generated
— it does not depend on the dictionary, so `scripts/build-dictionary.mjs`
leaves it alone on every rebuild. **That file is the authority**; the numbers
above are transcribed from it, and this section has already once been read as
current when it was describing a bag two versions old.

**Vowel floor and duplicate cap are unchanged** by this — they are about how
a *rack* reads, not where the weights come from. A 7-letter rack keeps a
floor of 2 vowels (`minVowels` in `shared/config.ts`) and a cap of 2 copies of
any one letter. Both are held over from the endless draw, which could keep
rolling until a rack met them; a bag cannot, so neither binds any more, and the
vowel share is set in the bag itself instead. They are documented here because
they are still in the config, not because they still do anything.

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

**These numbers were re-measured in September 2026**, twice. First after the bot
learned to chain plays and build squares deliberately — everything measured
before that was measured against a player that could only lay one word along one
line, and so almost never completed a 3x3, 0.00–0.15 per game across 120 games.
Then again once the simulator's block search became the deployed one: `maxBlocks
40, maxK 3` are now the defaults in `shared/sim/blocks.ts` rather than something
only `convex/bots.ts` passed, so an unconfigured `rank` — the simulator, the
property tests — searches squares exactly as the bot people play does. Any
balance conclusion drawn from figures older than this is worth re-checking
against these.

`npx tsx scripts/simulate.ts 200 2 shipped`, the shipped bag — seventy-one
tiles, twenty-seven of them vowels, 38%; the fifty above is the end threshold,
which is a different number — two identical bots, 200 games:

| | |
| --- | --- |
| seat 0 / seat 1 win % | 41 / 60 |
| mean score, seat 0 / seat 1 | 187 / 199 |
| turns per game | 25 |
| squares occupied per game | 55 |
| passes per game | 3.3 |
| 3x3 or larger per game | **3.55** (SE 0.08) |
| best turn, mean per game | 46 |
| best turn, 95th percentile | 59 |

**These games do not end the way the shipped game ends.** Every variant here has
a bag, and with a bag `shared/sim/game.ts:145-152` ignores `endThreshold`
entirely and plays until the bag is empty and somebody's hand is out. Live ends
at fifty tiles on the board (`convex/games.ts`, `schema.ts`). That is why the
row above reads fifty-five squares occupied under a heading whose first bullet
says fifty: **every per-game aggregate in the table is taken over about 10% more
board than a real game offers**, which inflates the totals — squares, points,
turns — by roughly that much on its own.

It compounds on the 3x3 row specifically. `blankPrice`
(`shared/sim/judgement.ts`) decays linearly to exactly zero at `endThreshold`,
so past fifty tiles a blank costs the simulated player nothing at all, and the
simulated player is holding three of them. The tail of every simulated game is
played with free blanks in a phase the real game has already ended. **This is a
mechanism by which the 3x3 column reads high**, and it is the reason the closing
paragraph below no longer claims the table errs only on the low side.

**Read that SE before comparing anything to anything.** It is the standard error
of the per-game mean, printed by the simulator itself, and at 200 games it is
0.08. The threshold for telling two *runs* apart is not that: the difference of
two means carries both errors, √2 × 0.08 ≈ 0.11, so two runs less than about
**0.23** squares a game apart are one run. (A seed-paired comparison would
justify something tighter, but the simulator never computes per-game
differences, so that is not a number this table can offer.) The live sweep
quoted below ran twenty-eight games an allowance; scaling by √(200/28) puts its
standard error near 0.2 — an estimate, since it predates the column — and its
own repeat measurements of one configuration, 1.89 and 2.71, came out much
further apart than that, which is the floor to believe.

The number that moved is the last-but-two. A 3x3 was 0.00–0.15 a game against a
bot that could only lay one word along one line, 1.99 once it could chain plays
and aim at squares, and 3.55 now. Only part of that last step belongs to the
block search: 1.99 was measured on an older build, so the controlled figure is a
before-and-after over the same twenty games either side of the defaults moving,
**1.90 → 3.05**, several times the floor at that sample. None of it is a rules
change: nothing in the rules ever suppressed squares, only players that could
not reach them.

Going **second** is worth something — 60/41 across 200 games (ties split, each
seat rounded on its own), on a mean-score gap of 12 points. At this sample a win
rate has a standard error of about 3.5 points, so a ten-point edge over even is
real. This is the reverse of what this table said when the seat advantage ran
62/38 the other way, and the reversal is not the block-search change: a run at
the old defaults immediately before it came out 20/80 to seat 1 as well — twenty
games, so thin on its own, but pointing the same way. Both
bots play the same way, so it is the board's advantage rather than either
player's, and it is the open question §9 should be read against — with the
direction now needing an explanation it did not need before.

Three caveats used to attach here, all of them one trade in three places: the
live bot's search was capped where the simulator's was not, because the bot's
turn was a Convex mutation, stopped at one second of user code, and a stopped
turn was not a slow turn but a failed one that nothing rescheduled. The turn is
now an action, with a ceiling in the minutes, and the pause a bot's turn takes
is held *inside* the turn rather than in front of it — so any search finishing
inside 1,600ms costs the person waiting exactly nothing. Every cap was then
measured again rather than simply lifted.

**One of the three closed, two new ones opened, and both of the new ones have
now closed as well.** Over twenty-eight whole games an allowance the live bot
went from 1.39 3×3s a game to 3.50 and from 340 points to 392, for 191ms of
mean thinking and
five turns in 772 — 0.6% — that ran past the pause and were therefore waited on
at all. That aggregate is several times its own noise floor and can be read
flatly. What that sweep said about individual knobs cannot: a per-game square
count at twenty-eight games is noisy enough that the same configuration measured
1.89 once and 2.71 another time, so every single-knob attribution it made was
judgement supported by direction.

The caveat that closed was `reletter`: the live bot's block solver may rewrite
standing letters, at the simulator's default of two. The two that opened and
have since closed are the block shortlist, `maxBlocks: 40` and `maxK: 3`, which
the live bot passed and the simulator did not until those became the `shared/`
defaults. That is the change this table was re-measured for. The simulator's
3.55 and the sweep's 3.50 sit close together, and it is tempting to read one as
confirming the other — but they are not the same configuration, as the next
three paragraphs say, and two of the differences push in opposite directions:
the simulator has three blanks where the sweep had one (worth about a square a
game against it, by the sweep's own fourteen-game reading) and no game-end
threshold (worth something in its favour). Two unmeasured effects of opposite
sign landing four hundredths apart is a coincidence, not corroboration. What the
re-measurement does establish is the thing it was run for: the simulator now
searches squares the way the deployed bot does, and the table is a statement
about that search rather than about a weaker one.

**Three divergences still stand, and they do not point the same way.**

The live bot's search is told about **one blank a turn** where the simulated
players may spend all three. This is now the measurement rather than the cap: at
two blanks the bot gains twelve points and loses squares while a ninth of its
turns become visible waits of up to 3.6 seconds; at three it is worse than one
at everything — 1.71 3×3s a game against 2.71, fewer points, and a third of all
turns spent in front of somebody. `blankPrice` charges for a blank so that it is
not spent lightly, and handing the search more of them mostly buys blank-heavy
moves that crowd better ones out of the shortlist. The cost is all in the block
solver, the only stage that spends a blank: a 2×2 on an empty board is four
cells tried against the rack and all twenty-six letters, which at three blanks
is some 39,000 solutions to price. **Live is capped, and the evidence says the
cap helps rather than hurts** — three concordant metrics and an unambiguous
timing all point one way. Not "measurably": the 2.71-against-1.71 gap is
fourteen games a side, and this document has just finished saying that a gap
that size at twenty-eight games is inside the floor. The direction is well
supported; the size of it is not established. On this axis the table above
understates the deployed bot.

The live bot **chains two plays from four candidates a step**, against the
simulator's six. Six is affordable now — 44ms and one turn in 703 past the pause
— but twenty-eight games cannot tell the two apart: 1.89 3×3s and 348 points at
breadth 4 against 1.86 and 344 at breadth 6. The cheaper one stays for want of
any reason to pay more. **Live is nominally weaker, measurably level.**

And the one that runs the other way: **the simulator always plays the best move
it found, and the live bot does not.** `bestMove` is `rank(...)[0]`
(`shared/sim/bot.ts`), so a simulated player is a perfect chooser over its own
ranking; `convex/bots.ts` draws through `chooseRanked`, which even at `hard`
samples a band of 85–100% of the best value with a softmax leaning toward the
top, and the two seats a person meets are whatever difficulties they were set
to. Nothing measures what that costs, and it is not a knob that can simply be
matched — a bot that always plays its best move is a different opponent, not a
better-configured one. **The simulator is the stronger player on this axis**,
and it is the reason the summary below is not "the table errs low".

What the two closed divergences were, since the argument for the settings still
has to live somewhere. `maxBlocks: 12` was what actually bound the block solver,
and lifting it to forty is the larger part of the gain; it also widens the
single-gap shortlist `blankMoves` works from, twelve to forty, which is a
separate effect in the same number and is intended. `maxK: 3` is measured
cheaper and judged no weaker: `candidateBlocks` sorts by k descending, so a
long shortlist fills from the front with 4×4 candidates, and a 4×4 essentially
never solves — sixteen cells against a rack of seven — so capping k spends the
shortlist on 3×3s instead of on proving 4×4s impossible, at 512ms a turn against
631ms. Note what the cap does not do: it bounds the block solver's *targets*,
not the board. The span and chain searches can still complete a 4×4
incidentally, and `newSquareBlocks` still pays 16 when they do.

So the table above measures the deployed *search*, which is what it was
re-measured to do, and no longer measures a materially weaker square-builder.
It does not measure the deployed *game*, and the honest summary is that it errs
in both directions at once:

- **High**, for two identified reasons: the games run about 10% past the point
  a real game ends, with `blankPrice` at zero and three blanks in hand for that
  whole tail; and the simulated player always takes its top-ranked move, where
  a live bot samples a band.
- **Low**, for one: the simulated player is handed three blanks a turn, and one
  is the better setting.

None of the three is quantified. That is a fair statement of what is known, and
it is a weaker licence than the previous version of this paragraph claimed:
**this table supports comparisons between rules variants measured the same way,
and it does not support a claim about the absolute rate anything happens at in a
real game.** Every variant row shares all three distortions, which is what makes
the comparison sound and the absolute number soft.

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

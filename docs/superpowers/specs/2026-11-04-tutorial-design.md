# Tutorial — design

Date: 2026-11-04
Status: draft, awaiting review

## Purpose

New players don't understand how a turn works or why a turn scores what it
scores. The rules in `docs/design.md` §3–§5 cover a lot: connectivity, the
crossword rule both ways, word points that count letters already on the
board, ×2/×3/×4 squares that pay once, 3×3 squares worth 33 that go to
whoever closes them, stacking (cap 2), blanks, and the +5 long-word bonus.
The Rules modal explains these in text. The tutorial teaches them by playing.

The tutorial is a guided replay of one real game. The new player takes one
seat. Two scripted opponents play the other seats exactly as they were played.
On the player's turns, ghost letters show where each tile goes. Play works
only when every tile is on its ghost. A coach card explains every move: the
player's own moves and the opponents' moves.

Second piece, smaller, in the same branch: make practice games (hints on)
easier to find.

## Goals

- A new player sees one whole game from start to finish, with every move
  explained, and leaves knowing how the turn and the scoring work.
- Every scoring concept shows up at least once, with its numbers spelled out.
- The tutorial is offered once to everybody and is always available after
  that.
- Practice (robots plus hints) is one tap from the `...` menu.

## Non-goals

- Free play inside the tutorial. The player cannot choose a different move.
- Saving progress mid-tutorial. Quitting means starting over next time.
- Stats. A tutorial never touches games played, wins, best game or best turn.
- A server-side game. The tutorial creates nothing in Convex.
- Translating or rewriting the Rules modal.

## Anti-goals

- Any hard or triggering word in the script. The template game was picked
  partly for this, and every word was read by eye. Any future template game
  needs the same check.
- Real players' names. Opponent names are changed.
- Explainer numbers that disagree with what the board scores. Every number
  shown comes from the engine and is checked against the recorded game in a
  test.
- A tutorial that looks or behaves differently from a real game. Same board,
  same rack, same drag and drop, same colors.

## The template game

Prod game `j57933av51r6sst9bd49djkhc98ffafq`. Rules version 12, layout Open,
no premium squares, 3 players, 17 turns, all plays, no passes or trades.
Final score Clintron 264, BenDBeatz 239, Ugona 253.

| Real seat | Real player | Tutorial seat | Name shown | Seat color |
|---|---|---|---|---|
| 0 | Clintron | opponent | Isolde | seat 0 (tomato) |
| 1 | BenDBeatz | **the new player** ("You") | player's own name, or "You" | seat 1 (pacific) |
| 2 | Ugona | opponent | Rostam | seat 2 (gold) |

Opponent names are my call, taken from `shared/names.ts` so they look like
the names robots get.

Turn-by-turn, what each move teaches (turn numbers start at 1; "x2" etc. =
a fresh multiplier square covered):

| # | Who | Tiles | Words | Score | Concepts |
|---|---|---|---|---|---|
| 1 | Isolde | 7 | UP CUT PIC TA | 15 | opening covers centre; x2 centre; x2 |
| 2 | **You** | 6 | ANA NITS PICA TUN STAB UN | 53 | **3×3**; blank; completer takes it |
| 3 | Rostam | 7 | KNAVE HIP PICK EMO IN | 28 | stack ×2; x3; long word |
| 4 | Isolde | 8 | SET CUB PICKS TUNER HUH BIN STAT | 75 | 3×3; x2; stack; blank; long words |
| 5 | **You** | 8 | MOB GEM BIOME | 40 | **x4**; blank; long word |
| 6 | Rostam | 8 | SNITS BIN CUBS MOP AI HUBS SNICKS PRIME AE | 77 | 3×3; 5 stacks; blank; long words |
| 7 | Isolde | 7 | LACE BUBS MOPE CHUBS YE | 32 | x3; stack; long word |
| 8 | **You** | 7 | DOGS LACEY GAL LO | 31 | **x4**; long word |
| 9 | Rostam | 7 | PRY DRILL EYE | 22 | x3; long word |
| 10 | Isolde | 9 | DE EN REFORMED | 105 | x3 × x4 compound; 2 blanks; long word |
| 11 | **You** | 8 | OS AN DRAGONS PRIMA MEMO | 43 | **4 stacks**; x3; blank; long words |
| 12 | Rostam | 8 | TOT ONE OSE RE OM TOO TEE REFORMER TUNERS | 71 | 3×3; stack; blank; long words |
| 13 | Isolde | 7 | BUDS PACEY PI IF HE DIN GAP DEFORMER PE HI TEES | 37 | 4 stacks; many cross words |
| 14 | **You** | 5 | WIFE AHEM DOM AW MEM HID | 64 | **3×3**; x3 |
| 15 | Rostam | 3 | RE DIGS MEME PAY LI | 15 | stacks; bag running out |
| 16 | **You** | 2 | OS OD | 8 | x3; end game |
| 17 | Rostam | 1 | ERE HIDE | 40 | single blank closes a 3×3; game ends |

Checked against the engine: replaying all 17 turns through
`applyPlacements`, `wordsFormed` and `scoreTurn` with the Open board's
multiplier squares reproduces every recorded word list and score. The 3×3s
land on turns 2, 4, 6, 12, 14 and 17, and the seat totals come to 264 / 239 /
253. Concept tags beyond squares and scores came from a quick scan; the
builder recomputes them.

**Going out.** By `docs/design.md` §6, a player is out once the bag and their
hand are both empty, and the game ends when everyone is out. Isolde goes out
after turn 13 and is skipped from then on, which is why turns 14–17 alternate
between You and Rostam. The coach text for turn 13 or 14 must explain the
skip, and the scoreboard must show Isolde as out the way a real game does.

## How it works for the player

### Where it starts

1. **Sign-in page.** The **How to play** button (`SignInForm` in
   `src/App.tsx`) becomes **Tutorial**. It starts the tutorial with no
   account.
2. **First-time popover.** Every signed-in account sees it once: brand-new
   accounts, guests, and existing players on their next login after release.
   It offers **Take the tutorial** and **Not now**. Either answer marks it
   seen. It never appears again for that account.
   - It never stacks on another popup. It waits until the display-name
     prompt (`DisplayNameNotice`), rule changes (`RuleChangesNotice`), game
     over (`GameOverNotice`) and friend requests (`FriendRequestsNotice`)
     are all closed (my call).
   - Guests see it right after guest sign-in. The game they chose on the
     sign-in page has already been dealt. **Not now** takes them into that
     game. **Take the tutorial** runs the tutorial, and the dealt game waits
     in the lobby.
   - If this device already finished or started the tutorial from the
     sign-in page, the popover is skipped and marked seen (my call). Stored
     in `localStorage`, read in try/catch, so a blocked store just means the
     popover shows.
3. **`...` menu.** A **Tutorial** item, always there when signed in.

The Rules modal stays in the `...` menu as it is.

### The screen

Layout A from the mockups (chosen): the coach card sits above the board, and
the board, rack and buttons stay where they are in a real game. Scoreboard on
top, same as a game.

```
 [ Isolde 15 ] [ You 0 ] [ Rostam 0 ]
 +-----------------------------------+
 | YOUR MOVE                  2 / 17 |
 | Close your first square. Put each |
 | letter on its ghost. ...          |
 +-----------------------------------+
 [            15x15 board           ]
 [  A  T  N  N  B  ?  ]   (rack)
 [ Recall ]  [ Play ]
```

A way out is always visible (my call: an × or "Leave tutorial" in the coach
card header). Leaving goes back to where the player came from with no
confirmation, since nothing is lost but position.

### The player's turn

- The rack holds exactly the tiles that turn places, blanks included. The
  real rack's other letters were never recorded, and showing letters the
  player can't use would only confuse.
- Every target square shows a **ghost**: the letter faded, with a dashed,
  pulsing outline in the player's seat color. For a blank, the ghost shows
  the letter the blank becomes; the rack shows the blank as `?` and placing
  it on its ghost assigns that letter with no letter picker.
- The player drags or taps tiles onto the board as in a real game.
- **Play** looks disabled until every ghost holds the right tile. Pressing it
  early still does something: the coach card turns into an error state and
  says exactly what's wrong, one problem at a time. Examples:
  - "The B goes one square left, under the A, on the glowing square." (tile
    on a square with no ghost — the tile gets a red ring)
  - "That square wants an N, not a T." (right square, wrong tile)
  - "Two more tiles to place." (ghosts still empty)
- Right letter on the right square is all that counts. Two identical letters
  are interchangeable.
- After Play: tiles commit, the score animates onto the scoreboard, any new
  3×3 gets outlined, and the coach card shows what the move scored, line by
  line, with a **Next** button.

### The opponent's turn

After **Next**, a short pause, then the opponent's tiles animate in the way
an opponent's move does in a real game (`useTurnReplay` / replay ring). The
coach card explains the move and its score breakdown, with **Next**. Nothing
for the player to do except read.

### Coach card text

Every one of the 17 turns has hand-written text. Two parts:

1. **The story**: one to three short sentences on what happened and why it
   matters. Plain words. Introduce each idea the first time it appears, then
   just name it. Examples from the mockups:
   - Turn 2: "You finished a 3×3, even though Isolde laid most of it.
     Whoever places the last tile takes the square."
   - Turn 3: "Rostam stacked a K on top of your A, turning PICA into PICK. A
     square can hold 2 tiles, so it can change hands once. EMO covers a
     triangle: ×3. KNAVE is 5 letters: +5 long word."
   - Player turns get a short instruction before the move ("Close your first
     square...") and the story after.
2. **The breakdown**: computed, never typed. Each word with its points and
   any multiplier, then the 3×3 bonus, long-word bonus, and total. The total
   must equal the recorded score.

Concepts that should be named the first time they come up: the opening word
must cover the centre; every run of 2+ tiles must be a word, both ways;
every new tile must touch the existing tiles; letters already on the board
count; multiplier squares pay once and compound; 3×3 = 33 and completer takes
it; stacking and the cap of 2; blanks (3 per game, never refill); long words
+5; going out (bag and hand empty, then skipped) and the game ending when
everyone is out.

I'll draft all 17 turns' text during the build and hand it over for review
before merging.

### The end

After turn 17 the normal game-over screen shows with the real final scores
(Isolde 264, Rostam 253, You 239: the player loses narrowly, as BenDBeatz
did). The coach card can say one closing line, e.g. that the bag ran out and
how close it was. Buttons:

- **New game**: signed in, opens the normal New game modal (guest: the guest
  modal). Signed out: starts a guest game, the same as the sign-in page's
  **Play the computer**.
- **Back to lobby**: signed out, back to the sign-in page.

Scoring is shown throughout, but nothing is saved to the account.

## Data

- **Script file in the repo**, e.g. `src/tutorial/script.ts`: the 17 turns
  (seat, placements with `isBlank`), plus per-turn coach text. Placements
  come from a one-off export of the prod game. The export sits in a
  session-only temp folder, so committing the cleaned script is the first
  build step. Raw rows are not committed; user IDs become seat numbers.
- **Breakdowns at runtime** from `shared/engine/score.ts` `scoreTurn`, with
  `bonusSquares` from `shared/boards.ts` for the Open 15×15 board, replaying
  the board with `src/lib/replay.ts` `boardAfter` (it already handles stacks).
- **A test** that replays the whole script through the engine and asserts,
  for every turn: placements are legal (`shared/engine/legality.ts`), words
  match the recorded words, score matches the recorded score. If rules
  change later and the test fails, the tutorial needs a new template game.
- **Seen flag**: `users.tutorialSeen: v.optional(v.boolean())`, same idea as
  the existing `rulesSeen`. One mutation to set it, and the viewer query
  returns it. Hand-edit `convex/_generated/api.d.ts` if a new module is
  added; do not run `convex codegen` (it pushes to dev here).

## Practice in the `...` menu

- New **Practice** item in the `...` menu (`src/components/Menu/Menu.tsx`),
  signed-in users, guests included.
- Opens a pared-back modal: **your color** (`SeatPicker`) and **number of
  players** (2–4). Every other seat is a robot at **medium** (my call, same as
  `GUEST_LEVEL`). Hints on. **Start**.
- Calls the existing `createGame` with `hints: true`. The server already
  accepts this when every other seat is a bot, and already leaves practice
  games out of stats.
- Remove the **Allow hints (practice game)** checkbox and its note from the
  Robots path in `CreateGame.tsx`. Robots games from there never have hints.
- Rematch of a practice game keeps hints, as it does now.

## Constraints

- TypeScript, React, CSS modules with tokens from `src/index.css`. No inline
  styles.
- Reuse `Board`, `Rack`, the staging/draft helpers, `Scoreboard`, `GameOver`
  and `Modal`. The tutorial feeds them local state instead of Convex queries.
  How much refactoring that takes is the builder's call, but the result must
  look and behave like a real game.
- Works on phone (portrait only; the landscape layout was reverted in
  9975251) and desktop, light and dark.
- Verify with `npm run typecheck`, `npm run lint`, and
  `npm test -- --no-file-parallelism`.

## Left to the builder

- Component structure, and how `Board`/`Rack` get fed local state.
- Ghost styling details beyond "faded letter, dashed pulsing outline, seat
  color", and the error-ring style.
- Animation timing for opponent moves.
- Whether the tutorial is its own route or an overlay over the lobby.
- Exact wording of popover, menu items and error messages (I'll review it).

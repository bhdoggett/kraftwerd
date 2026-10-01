# Coach hints — design

Date: 2026-10-01
Status: draft, awaiting review

## Purpose

Help a player learn the game against computer opponents. On their own turn
they can ask for the best moves their rack allows, see why each one scores,
and drop one onto the board. The aim is learning, so hint games are
practice: they never count toward a player's record.

The bot rework that came before this (`e534253`) gives the material: the
same search the bots use, with multiplier squares and 3x3 exposure priced
in, can explain the moves it finds.

## Decisions

| Question | Decision |
|---|---|
| Where hints exist | Only in games where every opponent is a bot |
| How a game gets hints | A toggle in game setup, off by default; fixed for the game's life |
| How many | Unlimited |
| Strength | Hard bot's search: full dictionary, whole rack, every blank left, turns up to 4 plays |
| Rare words | Shown, flagged as rare (not in `common-words.json`) |
| Picking a hint | Tap places its tiles as the pending move; the player still presses Play |
| Rack words | Collapsible list of common words the rack spells |
| 3x3 warning | On hint cards and live on the player's own pending move, in hint games |
| Records | A hint game counts toward nothing: games played, wins, best game, best turn |
| History | Hint games still listed, tagged "Practice" |

## Data model

`games.hints: v.optional(v.boolean())` — set at creation, never changed.
Absent reads as false, so every existing game is unaffected.

New table `hints`, a cache so a repeated tap or a reload costs a read, not a
search:

```
hints: defineTable({
  gameId: v.id("games"),
  userId: v.id("users"),
  turnNumber: v.number(),
  result: <HintResult validator>,
}).index("by_game_user_turn", ["gameId", "userId", "turnNumber"])
```

Rows for a finished game can be deleted when it finishes; they are never
read again.

## Server

### Game creation

`createGame` gains `hints: v.optional(v.boolean())`. Refused unless every
seat other than the maker's is a bot (`bots.length === playerCount - 1`).
`rematch` copies `hints` from the game it rematches. `GuestGame` never sets
it.

### Records

Two checks in `convex/games.ts`, both `game.hints !== true`:

1. where a play updates `bestTurnScore` (currently `games.ts:1057`);
2. where a finished game updates `gamesPlayed`, `wins`, `bestGameScore`
   (currently `games.ts:1191`).

Nothing else about finishing changes: winners, results and history are
recorded as for any game.

### Shared lexicon

The bot's lazily-built dictionaries move out of `convex/bots.ts` into
`convex/lexicon.ts` (`lexicon(vocabulary)`), used by both the bot and the
coach. Built once per isolate, read-only after, keyed by vocabulary — never
by game or player. No per-request state at module level, in this file or
the coach.

### `coach.hints({ gameId })` — public action

1. `ctx.runQuery(internal.coach.hintState, { gameId })`, an internal query
   that resolves the caller and refuses unless:
   - signed in, and seated in this game;
   - the game is active, `game.hints === true`, and it is the caller's turn.

   It returns the board tiles, the caller's own letters and blanks left, and
   the turn number. Never the bag, never another seat's rack.
2. Cache: if a `hints` row exists for (game, caller, turn), return it.
3. Search with `rank` (shared/sim/bot.ts): full lexicon, `LEVELS.hard`
   squares and chain (depth 4, breadth 4), blanks = all the caller has left,
   multiplier squares in the score, default exposure. `squares.nodeLimit`
   is capped (start at 2,000, tune on dev) so three blanks stay near two
   seconds at worst.
4. Walk the ranking best-first; keep the first three moves whose words all
   pass the game's dictionary (`wordsMissing`, as the bot does).
5. Explain each kept move (below), compute rack words, write the cache row
   through an internal mutation, return.

The client disables the button while a request is in flight, so a burst of
taps is one search. Two requests that do race (two tabs) both search and the
second write is dropped; that is wasted work, not a wrong answer.

### HintResult

```
{
  turnNumber: number,
  moves: Array<{
    placements: Placement[],        // x, y, letter, isBlank
    total: number,                  // scoreTurn(...).total
    words: Array<{ word: string, points: number, rare: boolean,
                   multiplier?: number, long?: true }>,
    squares: number,                // 3x3s completed
    leavesOpen: number,             // 3x3s left one tile short
  }>,
  rackWords: string[],              // see below
}
```

Reasons on a card come straight from these fields: "closes a 3x3 (+33)",
"x3 on STAB", "long word (+5)", "leaves a 3x3 open".

### Rack words

From the common lexicon's index: words of three letters or more the rack's
letters spell on their own, blanks ignored, longest first then
alphabetical, at most 20.

## Shared rule: `shared/engine/nearSquares.ts`

`nearSquares(before, placements, shape, size): Coord[][]` — the 3x3 blocks
the move leaves exactly one tile short, each as its cells. Pure geometry,
the same test `exposure` makes in `shared/sim/judgement.ts`, which should
call this rather than keep its own copy. Used by the coach for
`leavesOpen` and by the browser for the live warning.

## Client

### Setup

`CreateGame`, machines path: an "Allow hints (practice game)" toggle under
the bot levels, off by default, with one line under it: "Practice games
don't count toward your record." Passed to `createGame` as `hints`.

### In game (`Game.tsx`)

- A Hint button in the action bar, only when `game.hints` and it is your
  turn. Spinner while the action runs; disabled meanwhile.
- `HintPanel` (new component, CSS module): up to three cards, best first —
  points, the words, the reasons. Tapping a card replaces `pending` with its
  placements. Below the cards, "Words in your rack", collapsed by default.
- A result whose `turnNumber` is not the game's current turn is dropped.
  Results are held in component state keyed by turn number and cleared when
  the turn moves on.
- Live warning: in hint games, when `nearSquares` over the pending move is
  non-empty, "Leaves a 3x3 one tile short" shows beside the score preview.

### Tagging

A "Practice" tag on hint games in the game header and wherever games are
listed (lobby, history, game over).

## Load

At 1,000 daily users, five hints a game and two games each, hints are about
10,000 searches a day at roughly 1.5s: some four hours of action time,
against about fourteen for bot turns (26,000 turns, each holding its action
through the 1.6s thinking pause). The
cache keeps repeats free. Peak memory of an action holding both lexicons
and running a depth-4, three-blank search is measured on dev before
release.

## Testing

- `nearSquares`: one short, closed, blocked cell in the block, 2x2 ignored.
- `exposure` still passes its tests after switching to `nearSquares`.
- `createGame` refuses `hints` with a human seat; `rematch` keeps it.
- Records: a finished hint game leaves `gamesPlayed`, `wins`,
  `bestGameScore` and `bestTurnScore` unchanged; a normal game still counts.
- `coach.hints` (convex-test): refused when not your turn, not seated, or
  `hints` unset; returns at most three moves, every word in the
  dictionary, none using tiles the caller does not hold; second call for
  the same turn is served from the cache.
- `HintPanel`: tapping a card fills the pending move; stale turn dropped.

## Out of scope

- Hints in games with other people.
- Scheduling bot moves instead of holding the action through the thinking
  pause (a separate cost change, noted 2026-09-30).
- A frequency-ranked word list for the easy bot.

# Coach Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Practice games against bots where, on your turn, a Hint button shows the three best plays for your rack, why each scores, and the words your rack spells; tapping one stages it.

**Architecture:** A game is marked `hints: true` when it is made, from a toggle in setup; such games never touch the player's record. Hints are computed by a Convex action that runs the hard bot's search (`rank` in `shared/sim/bot.ts`) over the caller's own rack, explains each move with pure helpers in `shared/sim/coach.ts`, and caches the result per game, player and turn. The client shows them in a new `HintPanel` and stages a chosen one onto the board.

**Tech Stack:** Convex (actions, internal queries/mutations, convex-test), React + Vite, CSS modules with tokens from `src/index.css`, Vitest (projects: engine, convex, ui).

**Spec:** `docs/superpowers/specs/2026-10-01-coach-hints-design.md`

## Global Constraints

- TypeScript only. CSS modules only, using the `:root` tokens in `src/index.css` (`--space-*`, `--radius`, `--text-muted`, `--accent`, `--danger`, ...). No inline styles.
- Before touching anything in `convex/`, read `convex/_generated/ai/guidelines.md`.
- Hints exist only when every seat but the maker's is a bot: `bots.length >= 1 && bots.length === playerCount - 1`.
- Search for hints: full dictionary, all blanks the player has left, `LEVELS.hard.chain` (depth 4, breadth 4), `LEVELS.hard.squares` with `nodeLimit: 2_000`.
- At most 3 hint moves; rack words: common list only, 3+ letters, blanks ignored, longest first then alphabetical, at most 20.
- A hint game counts toward nothing: `gamesPlayed`, `wins`, `bestGameScore`, `bestTurnScore`.
- `coach.hints` reads only the board and the caller's own rack: never the bag, never another rack.
- No per-request state at module level. The only module-level cache is the lexicon, keyed by vocabulary.
- Verify with `npm run typecheck`, `npx eslint <paths> --max-warnings 0`, and `npx vitest run --no-file-parallelism` for the full suite (single files may run without the flag).
- Commit messages: conventional (`feat(coach): ...`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Pressing Hint, then playing before it answers: the late result must not show for the new turn (Task 6, `shownHint` test).
2. A hint that uses a letter twice when the rack holds it twice must stage two different rack tiles, not the same one twice (Task 6, `stageHint` duplicate test).
3. A rack with no legal play: the panel must say so rather than show nothing (Task 6, HintPanel empty test).
4. A rematch of a hint game must stay a hint game, so it doesn't suddenly start counting (Task 2, rematch test).
5. Someone calling `coach.hints` on another person's game, or on a game without hints, must be refused (Task 5, refusal tests).

---

### Task 1: `nearSquares` — the 3x3 blocks a move leaves one tile short

**Files:**
- Create: `shared/engine/nearSquares.ts`
- Create: `shared/engine/nearSquares.test.ts`
- Modify: `shared/sim/judgement.ts` (the "3x3s one tile from complete" loop inside `exposure`)

**Interfaces:**
- Produces: `nearSquares(before: Board, placements: readonly Coord[], shape: Pick<BoardShape, "blocked">, size: number): NearSquare[]` and `interface NearSquare { x: number; y: number; gap: Coord }` (`x`,`y` = block's top-left).

- [ ] **Step 1: Write the failing test**

`shared/engine/nearSquares.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { makeBoard } from "./board";
import { nearSquares } from "./nearSquares";

const at = (x: number, y: number, letter = "A") => ({ x, y, letter, isBlank: false });
const open = { blocked: new Set<string>() };

// Seven of a 3x3's nine squares at (6,6): all but (6,8) and (8,8).
const seven = () =>
  makeBoard([[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [7, 8]].map(([x, y]) => at(x, y)));

describe("nearSquares", () => {
  test("a move that leaves one gap reports the block and the gap", () => {
    expect(nearSquares(seven(), [at(6, 8)], open, 15)).toEqual([
      { x: 6, y: 6, gap: { x: 8, y: 8 } },
    ]);
  });

  test("closing the block leaves nothing", () => {
    const eight = new Map(seven());
    eight.set("6,8", { letter: "A", isBlank: false, stacked: 1 });
    expect(nearSquares(eight, [at(8, 8)], open, 15)).toEqual([]);
  });

  test("a block with a blocked square in it can never close", () => {
    const blocked = { blocked: new Set(["8,8"]) };
    expect(nearSquares(seven(), [at(6, 8)], blocked, 15)).toEqual([]);
  });

  test("a 2x2 one short is not a 3x3", () => {
    const board = makeBoard([at(7, 7), at(8, 7)]);
    expect(nearSquares(board, [at(7, 8)], open, 15)).toEqual([]);
  });

  test("blocks off the edge of the board are not counted", () => {
    const board = makeBoard([at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1), at(1, 2)]);
    expect(nearSquares(board, [at(0, 2)], open, 15)).toEqual([
      { x: 0, y: 0, gap: { x: 2, y: 2 } },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run shared/engine/nearSquares.test.ts`
Expected: FAIL, cannot find module `./nearSquares`.

- [ ] **Step 3: Implement**

`shared/engine/nearSquares.ts`:

```ts
import { SCORING_SQUARE_SIZE } from "../config.js";
import type { BoardShape } from "../boards.js";
import { cellKey, type Board, type Coord } from "./board.js";

/** A 3x3 one tile from complete: its top-left corner and the square still empty. */
export interface NearSquare {
  x: number;
  y: number;
  gap: Coord;
}

/**
 * The 3x3 blocks this move leaves exactly one tile short.
 *
 * Only blocks the move touches: anything further away was already that way
 * before the move and is not this move's doing -- the same locality
 * `newSquareBlocks` in squares.ts relies on. A block with a blocked square in
 * it can never close, so it is never one tile short.
 *
 * Shared by the bot's own caution (`exposure` in shared/sim/judgement.ts) and
 * by the coach, which warns a player about the same thing.
 */
export function nearSquares(
  before: Board,
  placements: readonly Coord[],
  shape: Pick<BoardShape, "blocked">,
  size: number,
): NearSquare[] {
  const k = SCORING_SQUARE_SIZE;
  const laid = new Set(placements.map((p) => cellKey(p.x, p.y)));
  const filled = (x: number, y: number) =>
    laid.has(cellKey(x, y)) || before.has(cellKey(x, y));

  const found: NearSquare[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        const ox = p.x - i;
        const oy = p.y - j;
        if (ox < 0 || oy < 0 || ox + k > size || oy + k > size) continue;
        const id = `${ox},${oy}`;
        if (seen.has(id)) continue;
        seen.add(id);

        let gap: Coord | null = null;
        let gaps = 0;
        let blocked = false;
        for (let dy = 0; dy < k && !blocked && gaps <= 1; dy++) {
          for (let dx = 0; dx < k; dx++) {
            const x = ox + dx;
            const y = oy + dy;
            if (shape.blocked.has(cellKey(x, y))) {
              blocked = true;
              break;
            }
            if (!filled(x, y)) {
              gaps++;
              gap = { x, y };
            }
          }
        }
        if (!blocked && gaps === 1 && gap !== null) found.push({ x: ox, y: oy, gap });
      }
    }
  }
  return found;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run shared/engine/nearSquares.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Make `exposure` use it**

In `shared/sim/judgement.ts`, replace the whole block from `// 3x3s one tile from complete, counted once each.` down to the closing brace of its `for (const p of placements)` loop with:

```ts
  // 3x3s one tile from complete.
  penalty += w.nearBlock * SQUARE_BONUS * nearSquares(before, placements, shape, size).length;
```

Add `import { nearSquares } from "../engine/nearSquares.js";`. Remove `SCORING_SQUARE_SIZE` from the `../config.js` import if nothing else in the file uses it.

- [ ] **Step 6: Run the bot's tests**

Run: `npx vitest run shared/sim/judgement.test.ts shared/sim/bot.test.ts`
Expected: PASS, unchanged counts.

- [ ] **Step 7: Commit**

```bash
git add shared/engine/nearSquares.ts shared/engine/nearSquares.test.ts shared/sim/judgement.ts
git commit -m "feat(engine): nearSquares, the 3x3s a move leaves one tile short

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Practice games — the `hints` flag, and records that skip it

**Files:**
- Modify: `convex/schema.ts` (`games` table, after `rulesVersion`)
- Modify: `convex/games.ts` — `createGame` args and insert (~line 240-331), `rematch` insert (~line 820), `placeTiles` best-turn check (~line 1057), `finishGame` stats guard (~line 1191), `listMyGames` row (~line 1700)
- Create: `convex/practice.test.ts`

**Interfaces:**
- Produces: `games.hints?: boolean`; `createGame` arg `hints?: boolean`; `listMyGames` rows gain `hints: boolean`.

- [ ] **Step 1: Write the failing tests**

`convex/practice.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { NAMES } from "../shared/names";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const CENTRE = 7;
const at = (x: number, letter: string) => ({ x: CENTRE + x, y: CENTRE, letter, isBlank: false });

async function botGame(hints: boolean) {
  const t = convexTest(schema, modules);
  const alice = await t.run(async (ctx) => {
    for (const word of ["CAT"]) await ctx.db.insert("words", { word });
    return await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
  });
  const asAlice = t.withIdentity({ subject: "auth|alice" });
  const { gameId } = await asAlice.mutation(api.games.createGame, {
    playerCount: 2,
    bots: [{ level: "easy", name: NAMES[0] }],
    hints,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("games", gameId, { status: "active", currentSeat: 0 });
    const mine = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
      .unique();
    await ctx.db.patch("players", mine!._id, { letters: ["C", "A", "T", "E", "E", "E", "E"] });
  });
  return { t, asAlice, alice, gameId };
}

const userRow = (t: Awaited<ReturnType<typeof botGame>>["t"], id: Id<"users">) =>
  t.run(async (ctx) => await ctx.db.get("users", id));

describe("practice games", () => {
  test("hints are refused when a seat waits for a person", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
    });
    const asAlice = t.withIdentity({ subject: "auth|alice" });
    await expect(
      asAlice.mutation(api.games.createGame, { playerCount: 2, hints: true }),
    ).rejects.toThrow("Hints are only for games against the computer");
    await expect(
      asAlice.mutation(api.games.createGame, { playerCount: 1, hints: true }),
    ).rejects.toThrow("Hints are only for games against the computer");
  });

  test("a game against bots can have hints", async () => {
    const { t, gameId } = await botGame(true);
    const game = await t.run(async (ctx) => await ctx.db.get("games", gameId));
    expect(game?.hints).toBe(true);
  });

  test("a best turn in a practice game is not recorded", async () => {
    const { t, asAlice, alice, gameId } = await botGame(true);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    expect((await userRow(t, alice))?.bestTurnScore ?? 0).toBe(0);
  });

  test("a best turn in an ordinary game still is", async () => {
    const { t, asAlice, alice, gameId } = await botGame(false);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    expect((await userRow(t, alice))?.bestTurnScore ?? 0).toBeGreaterThan(0);
  });

  test("a finished practice game counts toward nothing", async () => {
    const { t, asAlice, alice, gameId } = await botGame(true);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    await asAlice.mutation(api.games.resignGame, { gameId });
    const user = await userRow(t, alice);
    expect(user?.gamesPlayed ?? 0).toBe(0);
    expect(user?.wins ?? 0).toBe(0);
    expect(user?.bestGameScore ?? 0).toBe(0);
  });

  test("a finished ordinary game still counts", async () => {
    const { t, asAlice, alice, gameId } = await botGame(false);
    await asAlice.mutation(api.games.placeTiles, {
      gameId,
      placements: [at(-1, "C"), at(0, "A"), at(1, "T")],
    });
    await asAlice.mutation(api.games.resignGame, { gameId });
    expect((await userRow(t, alice))?.gamesPlayed ?? 0).toBe(1);
  });

  test("a rematch of a practice game is a practice game", async () => {
    const { t, asAlice, gameId } = await botGame(true);
    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { status: "finished" });
    });
    const { gameId: again } = await asAlice.mutation(api.games.rematch, { gameId });
    const game = await t.run(async (ctx) => await ctx.db.get("games", again));
    expect(game?.hints).toBe(true);
  });

  test("the lobby says which games are practice", async () => {
    const { asAlice } = await botGame(true);
    const mine = await asAlice.query(api.games.listMyGames, {});
    expect(mine.games.map((g) => g.hints)).toEqual([true]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run convex/practice.test.ts`
Expected: FAIL — `hints` is not an accepted argument (validator error) and `g.hints` is undefined.

- [ ] **Step 3: Schema**

In `convex/schema.ts`, in the `games` table after `rulesVersion: v.optional(v.number()),`:

```ts
    /**
     * A practice game: the Hint button is offered, and nothing here counts
     * toward anybody's record. Set when the game is made and never changed;
     * absent reads as an ordinary game.
     */
    hints: v.optional(v.boolean()),
```

- [ ] **Step 4: `createGame`**

Add to `createGame`'s `args`:

```ts
    /** A practice game with hints. Only when every other seat is a machine. */
    hints: v.optional(v.boolean()),
```

After the loop that checks bot names, add:

```ts
    const hints = args.hints === true;
    if (hints && (bots.length === 0 || bots.length !== args.playerCount - 1)) {
      throw new ConvexError("Hints are only for games against the computer");
    }
```

In the `ctx.db.insert("games", { ... })` call, after `rulesVersion: RULES_VERSION,` add:

```ts
      ...(hints ? { hints: true } : {}),
```

- [ ] **Step 5: `rematch`**

In `rematch`'s `ctx.db.insert("games", { ... })`, after `rulesVersion: RULES_VERSION,` add:

```ts
      // Practice stays practice: a rematch is the same table over again.
      ...(before.hints === true ? { hints: true } : {}),
```

- [ ] **Step 6: Records**

In `placeTiles`, change

```ts
    if (played !== null && (game.rulesVersion ?? 0) === RULES_VERSION) {
```

to

```ts
    if (played !== null && (game.rulesVersion ?? 0) === RULES_VERSION && game.hints !== true) {
```

In `finishGame`, change

```ts
  if ((game.rulesVersion ?? 0) !== RULES_VERSION) return;
```

to

```ts
  // A practice game (hints on) counts toward no one's record either.
  if ((game.rulesVersion ?? 0) !== RULES_VERSION || game.hints === true) return;
```

and add a line to the comment above it: `Nor does a practice game: its hints were offered to every person at it.`

- [ ] **Step 7: Lobby rows**

In `listMyGames`, in the object each row returns, after `abandoned: ...,` add:

```ts
          /** A practice game: hints on, counted toward nothing. */
          hints: game.hints === true,
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run convex/practice.test.ts convex/games.test.ts convex/bots.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck` — expected clean.

```bash
git add convex/schema.ts convex/games.ts convex/practice.test.ts
git commit -m "feat(games): practice games with hints, kept out of the record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One lexicon cache for the bot and the coach

**Files:**
- Create: `convex/lexicon.ts`
- Modify: `convex/bots.ts` (remove the `ALL_WORDS`/`COMMON_WORDS` imports, `lexicons`, `thinking`; call `lexicon(...)`)
- Create: `convex/lexicon.test.ts`

**Interfaces:**
- Consumes: `Lexicon`, `Vocabulary` from `shared/sim/levels.ts`; `indexWords` from `shared/sim/bot.ts`; `makeDictionary` from `shared/engine/dictionary.ts`.
- Produces: `lexicon(vocabulary: Vocabulary): Lexicon`.

- [ ] **Step 1: Write the failing test**

`convex/lexicon.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { lexicon } from "./lexicon";

describe("lexicon", () => {
  test("each vocabulary is built once and kept", () => {
    expect(lexicon("common")).toBe(lexicon("common"));
  });

  test("the common list leaves out what the full list has", () => {
    expect(lexicon("full").dictionary.has("AAL")).toBe(true);
    expect(lexicon("common").dictionary.has("AAL")).toBe(false);
    expect(lexicon("common").dictionary.has("CAT")).toBe(true);
  });
}, 60_000);
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run convex/lexicon.test.ts`
Expected: FAIL, cannot find module `./lexicon`.

- [ ] **Step 3: Implement**

`convex/lexicon.ts` — move the comment above `thinking()` in `convex/bots.ts` here with it:

```ts
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import COMMON_WORDS from "../shared/data/common-words.json" with { type: "json" };
import { makeDictionary } from "../shared/engine/dictionary.js";
import { indexWords } from "../shared/sim/bot.js";
import type { Lexicon, Vocabulary } from "../shared/sim/levels.js";

/**
 * Built on first use, not when the module loads, and kept for the life of
 * the isolate. Keyed by vocabulary and nothing else: it is the same for every
 * game and every player, and never changes once built, so concurrent bot
 * turns and hints share it safely.
 */
const built: Partial<Record<Vocabulary, Lexicon>> = {};

/**
 * A dictionary to check words against and an index to search, from one list.
 *
 * [Move the "Only words up to seven letters are indexed..." and "One pair per
 * vocabulary..." paragraphs from `thinking()` in convex/bots.ts here,
 * verbatim.]
 */
export function lexicon(vocabulary: Vocabulary): Lexicon {
  const list = vocabulary === "full" ? ALL_WORDS : COMMON_WORDS;
  built[vocabulary] ??= {
    dictionary: makeDictionary(list),
    words: indexWords(list.filter((word) => word.length <= 7), 7),
  };
  return built[vocabulary];
}
```

(The bracketed line is an instruction to move existing comment text, not text to paste.)

In `convex/bots.ts`: delete the two JSON imports, the `makeDictionary` and `indexWords` imports if now unused, the `lexicons` constant, the doc comment above it that is about building on the first bot turn (move its gist — "indexing the dictionary is a bot's cost and should be charged to bots" — into lexicon.ts's comment, reworded to "to whoever uses it"), and `thinking()`. Add `import { lexicon } from "./lexicon";` and change `const { dictionary, words } = thinking(level.vocabulary);` to `const { dictionary, words } = lexicon(level.vocabulary);`. Drop `Lexicon`/`Vocabulary` from the levels import there if unused.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run convex/lexicon.test.ts convex/bots.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npm run typecheck && npx eslint convex/lexicon.ts convex/bots.ts --max-warnings 0`

```bash
git add convex/lexicon.ts convex/lexicon.test.ts convex/bots.ts
git commit -m "refactor(convex): one lexicon cache, for the bot and what comes next

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `shared/sim/coach.ts` — choose and explain hints

**Files:**
- Create: `shared/sim/coach.ts`
- Create: `shared/sim/coach.test.ts`

**Interfaces:**
- Consumes: `rank` (`shared/sim/bot.ts`), `LEVELS`, `Lexicon` (`shared/sim/levels.ts`), `scoreTurn` (`shared/engine/score.ts`), `applyPlacements` (`shared/engine/legality.ts`), `nearSquares` (Task 1), `rackWords` (`shared/sim/words.ts`).
- Produces:

```ts
export interface HintWord { word: string; points: number; rare: boolean; multiplier?: number; long?: boolean }
export interface HintMove { placements: Placement[]; total: number; words: HintWord[]; squares: number; leavesOpen: number }
export interface Coaching { moves: HintMove[]; rackWords: string[] }
export interface HintResult extends Coaching { turnNumber: number }
export const MAX_HINTS = 3;
export const MAX_RACK_WORDS = 20;
export function explain(before: Board, placements: readonly Placement[], common: Lexicon, shape: BoardShape, size: number): HintMove
export function rackWordsOf(letters: readonly string[], common: Lexicon): string[]
export function coach(board: Board, hand: Hand, full: Lexicon, common: Lexicon, shape: BoardShape, size: number): Coaching
```

- [ ] **Step 1: Write the failing tests**

`shared/sim/coach.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { boardShapeNamed, OPEN_BOARD } from "../boards";
import { makeBoard } from "../engine/board";
import { makeDictionary } from "../engine/dictionary";
import { coach, explain, rackWordsOf, MAX_HINTS } from "./coach";
import { indexWords } from "./words";

const lex = (words: string[]) => ({ dictionary: makeDictionary(words), words: indexWords(words, 7) });
const FULL = lex(["CAT", "ACT", "CATS", "ACTS", "SCAT", "AT", "TA", "AS", "SAT", "TAS"]);
const COMMON = lex(["CAT", "ACT", "CATS", "ACTS", "AT", "AS", "SAT"]);
const shape = boardShapeNamed(OPEN_BOARD, 15);
const at = (x: number, y: number, letter: string, isBlank = false) => ({ x, y, letter, isBlank });

describe("rack words", () => {
  test("three letters and up, longest first, then alphabetical, common only", () => {
    expect(rackWordsOf(["C", "A", "T", "S"], COMMON)).toEqual(["ACTS", "CATS", "ACT", "CAT", "SAT"]);
  });

  test("blanks are not letters", () => {
    expect(rackWordsOf(["C", "A"], COMMON)).toEqual([]);
  });
});

describe("explaining a move", () => {
  test("an opening across the centre is doubled, and says so", () => {
    const move = explain(makeBoard([]), [at(6, 7, "C"), at(7, 7, "A"), at(8, 7, "T")], COMMON, shape, 15);
    expect(move.total).toBe(6);
    expect(move.words).toEqual([{ word: "CAT", points: 6, rare: false, multiplier: 2 }]);
    expect(move.squares).toBe(0);
    expect(move.leavesOpen).toBe(0);
  });

  test("a word missing from the common list is rare", () => {
    const move = explain(makeBoard([]), [at(6, 7, "T"), at(7, 7, "A"), at(8, 7, "S")], COMMON, shape, 15);
    expect(move.words[0]).toMatchObject({ word: "TAS", rare: true });
  });
});

describe("coaching", () => {
  test("at most three moves, each made from the rack and every word in the full list", () => {
    const rack = ["C", "A", "T", "S"];
    const { moves } = coach(makeBoard([]), { letters: rack, blanks: 0 }, FULL, COMMON, shape, 15);

    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(MAX_HINTS);
    for (const move of moves) {
      const left = [...rack];
      for (const p of move.placements) {
        const i = left.indexOf(p.letter);
        expect(i).toBeGreaterThanOrEqual(0);
        left.splice(i, 1);
      }
      for (const w of move.words) expect(FULL.dictionary.has(w.word)).toBe(true);
    }
  });

  test("no play is no moves, not an error", () => {
    const { moves } = coach(makeBoard([]), { letters: ["Q"], blanks: 0 }, FULL, COMMON, shape, 15);
    expect(moves).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run shared/sim/coach.test.ts`
Expected: FAIL, cannot find module `./coach`.

- [ ] **Step 3: Implement**

`shared/sim/coach.ts`:

```ts
/**
 * Hints for a person: the bot's search, pointed at their own rack, and the
 * reasons each move scores.
 *
 * The hard bot's search (shared/sim/levels.ts), so a hint shows what is
 * really on offer -- including the squares that need a word nobody knows,
 * flagged as rare rather than left out. Ranked by value, not by points, so a
 * move that hands the bot a square is pushed down the list the way the bot
 * would push it down its own.
 */
import type { BoardShape } from "../boards.js";
import type { Board } from "../engine/board.js";
import { applyPlacements } from "../engine/legality.js";
import { nearSquares } from "../engine/nearSquares.js";
import { scoreTurn, type Placement } from "../engine/score.js";
import { rank } from "./bot.js";
import type { Hand, ValueFn } from "./components.js";
import { LEVELS, type Lexicon } from "./levels.js";
import { rackWords } from "./words.js";

export interface HintWord {
  word: string;
  points: number;
  /** Not in the common list: a real word, but not one most people know. */
  rare: boolean;
  /** The multiplier squares this word crossed, multiplied together. */
  multiplier?: number;
  /** Earned the long-word bonus. */
  long?: boolean;
}

export interface HintMove {
  placements: Placement[];
  total: number;
  words: HintWord[];
  /** 3x3s this move completes. */
  squares: number;
  /** 3x3s this move leaves one tile short, for whoever plays next. */
  leavesOpen: number;
}

export interface Coaching {
  moves: HintMove[];
  /** Common words the rack's own letters spell, ignoring the board. */
  rackWords: string[];
}

/** What the coach action answers with: coaching for one turn of one game. */
export interface HintResult extends Coaching {
  turnNumber: number;
}

export const MAX_HINTS = 3;
export const MAX_RACK_WORDS = 20;

/**
 * The hard bot's search, with the square solver's node budget capped: a hint
 * is a person waiting on a button, and with three blanks in hand the uncapped
 * solver measured up to six seconds.
 */
const SEARCH = {
  chain: LEVELS.hard.chain,
  squares: { ...LEVELS.hard.squares, nodeLimit: 2_000 },
};

export function explain(
  before: Board,
  placements: readonly Placement[],
  common: Lexicon,
  shape: BoardShape,
  size: number,
): HintMove {
  const after = applyPlacements(before, placements);
  const score = scoreTurn(after, placements, { before, bonusSquares: shape.bonusSquares });
  return {
    placements: placements.map(({ x, y, letter, isBlank }) => ({ x, y, letter, isBlank })),
    total: score.total,
    words: score.words.map((w) => ({
      word: w.word,
      points: w.points,
      rare: !common.dictionary.has(w.word),
      ...(w.bonus !== undefined ? { multiplier: w.bonus } : {}),
      ...(w.long === true ? { long: true } : {}),
    })),
    squares: score.squares.length,
    leavesOpen: nearSquares(before, placements, shape, size).length,
  };
}

export function rackWordsOf(letters: readonly string[], common: Lexicon): string[] {
  const found = new Set<string>();
  for (let length = Math.min(letters.length, 7); length >= 3; length--) {
    const index = common.words.byLength.get(length);
    if (index === undefined) continue;
    for (const i of rackWords(index, letters, length)) found.add(index.words[i]);
  }
  return [...found]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, MAX_RACK_WORDS);
}

export function coach(
  board: Board,
  hand: Hand,
  full: Lexicon,
  common: Lexicon,
  shape: BoardShape,
  size: number,
): Coaching {
  const scoreOf: ValueFn = (after, placements, before) =>
    scoreTurn(after, placements, { before, bonusSquares: shape.bonusSquares }).total;
  const ranked = rank(board, hand, full.dictionary, full.words, shape, size, scoreOf, SEARCH);
  return {
    moves: ranked.slice(0, MAX_HINTS).map((m) => explain(board, m.placements, common, shape, size)),
    rackWords: rackWordsOf(hand.letters, common),
  };
}
```

If `rackWords` is not exported from `shared/sim/words.ts`, or `Hand`/`ValueFn` are not exported from `components.ts`, export them (they are used across `shared/sim` already; check with `grep -n "export" shared/sim/words.ts shared/sim/components.ts`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run shared/sim/coach.test.ts`
Expected: PASS (6 tests). If `rackWordsOf` order differs, check the expected list against the sort rule, not the other way round.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add shared/sim/coach.ts shared/sim/coach.test.ts
git commit -m "feat(coach): choose and explain hints for a rack

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `coach.hints` — the action, its guard, and its cache

**Files:**
- Create: `convex/hintResult.ts` (validator)
- Modify: `convex/schema.ts` (new `hints` table)
- Create: `convex/coach.ts`
- Create: `convex/coach.test.ts`

**Interfaces:**
- Consumes: `lexicon` (Task 3), `coach` and `HintResult` (Task 4), `seatOf` (`convex/seats.ts`), `requireUser` (`convex/auth_helpers.ts`), `loadTiles`, `blanksLeft` (`convex/games.ts`), `boardShapeNamed`, `OPEN_BOARD` (`shared/boards.ts`), `makeBoard` (`shared/engine/board.ts`).
- Produces: public action `api.coach.hints({ gameId }): HintResult`; internal `internal.coach.hintState`, `internal.coach.saveHint`.

- [ ] **Step 1: Validator and table**

`convex/hintResult.ts`:

```ts
import { v } from "convex/values";

/** What `coach.hints` answers with -- see HintResult in shared/sim/coach.ts. */
export const hintResult = v.object({
  turnNumber: v.number(),
  moves: v.array(
    v.object({
      placements: v.array(
        v.object({ x: v.number(), y: v.number(), letter: v.string(), isBlank: v.boolean() }),
      ),
      total: v.number(),
      words: v.array(
        v.object({
          word: v.string(),
          points: v.number(),
          rare: v.boolean(),
          multiplier: v.optional(v.number()),
          long: v.optional(v.boolean()),
        }),
      ),
      squares: v.number(),
      leavesOpen: v.number(),
    }),
  ),
  rackWords: v.array(v.string()),
});
```

In `convex/schema.ts`, `import { hintResult } from "./hintResult";` and add a table:

```ts
  /**
   * Hints already worked out, one row per game, player and turn, so asking
   * twice -- or reloading -- costs a read rather than a search. Left in place
   * when a game ends.
   */
  hints: defineTable({
    gameId: v.id("games"),
    userId: v.id("users"),
    turnNumber: v.number(),
    result: hintResult,
  }).index("by_game_user_turn", ["gameId", "userId", "turnNumber"]),
```

- [ ] **Step 2: Write the failing tests**

`convex/coach.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import { makeDictionary } from "../shared/engine/dictionary";
import { NAMES } from "../shared/names";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const FULL = makeDictionary(ALL_WORDS);
const RACK = ["C", "A", "T", "S", "E", "R", "O"];

async function table(hints: boolean) {
  const t = convexTest(schema, modules);
  const alice = await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "auth|bob", name: "Bob" });
    return await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
  });
  const asAlice = t.withIdentity({ subject: "auth|alice" });
  const { gameId } = await asAlice.mutation(api.games.createGame, {
    playerCount: 2,
    bots: [{ level: "easy", name: NAMES[0] }],
    hints,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("games", gameId, { status: "active", currentSeat: 0 });
    const mine = await ctx.db
      .query("players")
      .withIndex("by_game_and_user", (q) => q.eq("gameId", gameId).eq("userId", alice))
      .unique();
    await ctx.db.patch("players", mine!._id, { letters: [...RACK], blanks: 0 });
  });
  return { t, asAlice, gameId };
}

describe("coach.hints", () => {
  test("up to three moves from your own rack, every word a word", async () => {
    const { asAlice, gameId } = await table(true);
    const result = await asAlice.action(api.coach.hints, { gameId });

    expect(result.turnNumber).toBe(0);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.length).toBeLessThanOrEqual(3);
    for (const move of result.moves) {
      const left = [...RACK];
      for (const p of move.placements) {
        expect(p.isBlank).toBe(false);
        const i = left.indexOf(p.letter);
        expect(i).toBeGreaterThanOrEqual(0);
        left.splice(i, 1);
      }
      for (const w of move.words) expect(FULL.has(w.word)).toBe(true);
    }
    expect(result.rackWords.length).toBeGreaterThan(0);
  }, 120_000);

  test("asking twice in one turn searches once", async () => {
    const { t, asAlice, gameId } = await table(true);
    const first = await asAlice.action(api.coach.hints, { gameId });
    const second = await asAlice.action(api.coach.hints, { gameId });
    expect(second).toEqual(first);
    const rows = await t.run(async (ctx) => await ctx.db.query("hints").collect());
    expect(rows).toHaveLength(1);
  }, 120_000);

  test("refused in a game without hints", async () => {
    const { asAlice, gameId } = await table(false);
    await expect(asAlice.action(api.coach.hints, { gameId })).rejects.toThrow(
      "Hints are off in this game",
    );
  });

  test("refused when it is not your turn", async () => {
    const { t, asAlice, gameId } = await table(true);
    await t.run(async (ctx) => {
      await ctx.db.patch("games", gameId, { currentSeat: 1 });
    });
    await expect(asAlice.action(api.coach.hints, { gameId })).rejects.toThrow(
      "Hints are for your own turn",
    );
  });

  test("refused to someone not at the table", async () => {
    const { t, gameId } = await table(true);
    const asBob = t.withIdentity({ subject: "auth|bob" });
    await expect(asBob.action(api.coach.hints, { gameId })).rejects.toThrow(
      "You are not in this game",
    );
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run convex/coach.test.ts`
Expected: FAIL — `api.coach` does not exist.

- [ ] **Step 4: Implement**

`convex/coach.ts`:

```ts
import { ConvexError, v } from "convex/values";
import { OPEN_BOARD, boardShapeNamed } from "../shared/boards.js";
import { makeBoard, type TileSpec } from "../shared/engine/board.js";
import { coach, type HintResult } from "../shared/sim/coach.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { blanksLeft, loadTiles } from "./games.js";
import { hintResult } from "./hintResult";
import { lexicon } from "./lexicon";
import { seatOf } from "./seats";

/**
 * What a hint is worked out from, or the answer already worked out.
 *
 * Refuses anybody but the player on turn in a practice game. Reads the board
 * and that player's own rack -- never the bag and never another rack, which
 * would let a hint see what nobody at the table can.
 */
export const hintState = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get("games", args.gameId);
    if (game === null) throw new ConvexError("No such game");
    if (game.hints !== true) throw new ConvexError("Hints are off in this game");
    if (game.status !== "active") throw new ConvexError("This game is not being played");

    const me = await seatOf(ctx, args.gameId, userId);
    if (me === null) throw new ConvexError("You are not in this game");
    if (me.seat !== game.currentSeat) throw new ConvexError("Hints are for your own turn");

    const cached = await ctx.db
      .query("hints")
      .withIndex("by_game_user_turn", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId).eq("turnNumber", game.turnNumber),
      )
      .unique();
    if (cached !== null) return { kind: "cached" as const, result: cached.result };

    const tiles = await loadTiles(ctx, args.gameId);
    return {
      kind: "search" as const,
      userId,
      turnNumber: game.turnNumber,
      boardSize: game.boardSize,
      letters: me.letters,
      blanks: blanksLeft(me),
      tiles: tiles.map(
        (t): TileSpec => ({
          x: t.x,
          y: t.y,
          letter: t.letter,
          isBlank: t.isBlank,
          stacked: t.stacked ?? 1,
        }),
      ),
    };
  },
});

type HintState =
  | { kind: "cached"; result: HintResult }
  | {
      kind: "search";
      userId: Id<"users">;
      turnNumber: number;
      boardSize: number;
      letters: string[];
      blanks: number;
      tiles: TileSpec[];
    };

/** Keep a turn's hints. A second search for the same turn (two tabs) loses quietly. */
export const saveHint = internalMutation({
  args: {
    gameId: v.id("games"),
    userId: v.id("users"),
    turnNumber: v.number(),
    result: hintResult,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hints")
      .withIndex("by_game_user_turn", (q) =>
        q.eq("gameId", args.gameId).eq("userId", args.userId).eq("turnNumber", args.turnNumber),
      )
      .unique();
    if (existing === null) await ctx.db.insert("hints", args);
    return null;
  },
});

/**
 * The best plays for your rack this turn, and why they score.
 *
 * An action because the search is not a transaction and can take a second or
 * two; see convex/bots.ts for the same reasoning about bot turns.
 */
export const hints = action({
  args: { gameId: v.id("games") },
  returns: hintResult,
  handler: async (ctx, args): Promise<HintResult> => {
    const state: HintState = await ctx.runQuery(internal.coach.hintState, args);
    if (state.kind === "cached") return state.result;

    const shape = boardShapeNamed(OPEN_BOARD, state.boardSize);
    const coaching = coach(
      makeBoard(state.tiles),
      { letters: state.letters, blanks: state.blanks },
      lexicon("full"),
      lexicon("common"),
      shape,
      state.boardSize,
    );
    const result: HintResult = { turnNumber: state.turnNumber, ...coaching };

    await ctx.runMutation(internal.coach.saveHint, {
      gameId: args.gameId,
      userId: state.userId,
      turnNumber: state.turnNumber,
      result,
    });
    return result;
  },
});
```

Check two details against the code before running: the `TileSpec` fields match what `convex/bots.ts` `turnState` builds (it maps `x, y, letter, isBlank, stacked: t.stacked ?? 1`), and `loadTiles`/`blanksLeft` are exported from `convex/games.ts` (they are imported by `bots.ts` from `./games.js`).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run convex/coach.test.ts`
Expected: PASS (5 tests). The first test builds the full lexicon, so allow it up to two minutes.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `npm run typecheck && npx eslint convex/coach.ts convex/hintResult.ts convex/schema.ts --max-warnings 0`

```bash
git add convex/hintResult.ts convex/schema.ts convex/coach.ts convex/coach.test.ts
git commit -m "feat(coach): hints action, cached per game, player and turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The hint panel in the game

**Files:**
- Create: `src/lib/stageHint.ts`, `src/lib/stageHint.test.ts`
- Create: `src/lib/hintReasons.ts`, `src/lib/hintReasons.test.ts`
- Create: `src/components/HintPanel/HintPanel.tsx`, `HintPanel.module.css`, `HintPanel.test.tsx`
- Modify: `src/components/Game/Game.tsx`, `src/components/Game/Game.module.css`

**Interfaces:**
- Consumes: `api.coach.hints` (Task 5); `HintMove`, `HintResult` types (Task 4); `nearSquares` (Task 1); `Selection` (`src/components/Rack/Rack.tsx`).
- Produces: `stageHint(placements, letters): StagedHint[] | null`; `reasonsOf(move: HintMove): string[]`; `shownHint(result: HintResult | null, turnNumber: number): HintResult | null`; `<HintPanel canAsk result loading error onAsk onPick />`.

- [ ] **Step 1: Write the failing tests for the helpers**

`src/lib/stageHint.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { shownHint, stageHint } from "./stageHint";

const p = (x: number, letter: string, isBlank = false) => ({ x, y: 7, letter, isBlank });

describe("stageHint", () => {
  test("each placement takes its own rack tile, duplicates included", () => {
    expect(stageHint([p(6, "E"), p(7, "E")], ["E", "T", "E"])).toEqual([
      { ...p(6, "E"), from: { kind: "letter", index: 0 } },
      { ...p(7, "E"), from: { kind: "letter", index: 2 } },
    ]);
  });

  test("a blank comes from the blanks, whatever it stands for", () => {
    expect(stageHint([p(6, "Q", true)], ["A"])).toEqual([
      { ...p(6, "Q", true), from: { kind: "blank" } },
    ]);
  });

  test("a hint the rack no longer holds is refused", () => {
    expect(stageHint([p(6, "Z")], ["A"])).toBeNull();
  });
});

describe("shownHint", () => {
  const result = { turnNumber: 4, moves: [], rackWords: [] };
  test("shown on the turn it was asked for", () => {
    expect(shownHint(result, 4)).toBe(result);
  });
  test("dropped once the turn has moved on", () => {
    expect(shownHint(result, 5)).toBeNull();
  });
});
```

`src/lib/hintReasons.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { reasonsOf } from "./hintReasons";

const move = (over: object) => ({
  placements: [],
  total: 0,
  words: [],
  squares: 0,
  leavesOpen: 0,
  ...over,
});

describe("reasonsOf", () => {
  test("a square, a multiplier, a long word and a warning, in that order", () => {
    expect(
      reasonsOf(
        move({
          squares: 1,
          words: [
            { word: "STAB", points: 12, rare: false, multiplier: 3 },
            { word: "BOATS", points: 5, rare: false, long: true },
          ],
          leavesOpen: 1,
        }),
      ),
    ).toEqual(["closes a 3×3 (+33)", "×3 on STAB", "long word (+5)", "leaves a 3×3 one tile short"]);
  });

  test("two squares say two", () => {
    expect(reasonsOf(move({ squares: 2 }))).toEqual(["closes 2 3×3s (+66)"]);
  });

  test("a plain word has no reasons", () => {
    expect(reasonsOf(move({ words: [{ word: "CAT", points: 3, rare: false }] }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/stageHint.test.ts src/lib/hintReasons.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the helpers**

`src/lib/stageHint.ts`:

```ts
import type { Placement } from "../../shared/engine/score";
import type { HintResult } from "../../shared/sim/coach";
import type { Selection } from "../components/Rack/Rack";

export type StagedHint = Placement & { from: Selection };

/**
 * A hint's tiles as a pending move: each placement mapped to a rack tile that
 * could make it, every tile used once. Null when the rack no longer holds the
 * letters -- the hint is for a rack that has since changed.
 */
export function stageHint(
  placements: readonly Placement[],
  letters: readonly string[],
): StagedHint[] | null {
  const used = new Set<number>();
  const staged: StagedHint[] = [];
  for (const p of placements) {
    if (p.isBlank) {
      staged.push({ ...p, from: { kind: "blank" } });
      continue;
    }
    const index = letters.findIndex((letter, i) => letter === p.letter && !used.has(i));
    if (index < 0) return null;
    used.add(index);
    staged.push({ ...p, from: { kind: "letter", index } });
  }
  return staged;
}

/** A result only belongs to the turn it was asked on; a late one is dropped. */
export function shownHint(result: HintResult | null, turnNumber: number): HintResult | null {
  return result !== null && result.turnNumber === turnNumber ? result : null;
}
```

`src/lib/hintReasons.ts`:

```ts
import { LONG_WORD_BONUS, SQUARE_BONUS } from "../../shared/config";
import type { HintMove } from "../../shared/sim/coach";

/** Why a hint scores, one short phrase per reason, biggest first. */
export function reasonsOf(move: HintMove): string[] {
  const reasons: string[] = [];
  if (move.squares === 1) reasons.push(`closes a 3×3 (+${SQUARE_BONUS})`);
  if (move.squares > 1) reasons.push(`closes ${move.squares} 3×3s (+${SQUARE_BONUS * move.squares})`);
  for (const w of move.words) {
    if (w.multiplier !== undefined) reasons.push(`×${w.multiplier} on ${w.word}`);
  }
  const long = move.words.filter((w) => w.long === true).length;
  if (long > 0) reasons.push(`long word (+${LONG_WORD_BONUS * long})`);
  if (move.leavesOpen > 0) reasons.push("leaves a 3×3 one tile short");
  return reasons;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/lib/stageHint.test.ts src/lib/hintReasons.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing HintPanel test**

`src/components/HintPanel/HintPanel.test.tsx` (copy the import style of `src/components/Board/Board.test.tsx` if it differs):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { HintPanel } from "./HintPanel";

const MOVE = {
  placements: [{ x: 7, y: 7, letter: "A", isBlank: false }],
  total: 39,
  words: [
    { word: "CAT", points: 6, rare: false, multiplier: 2 },
    { word: "QAT", points: 3, rare: true },
  ],
  squares: 1,
  leavesOpen: 0,
};
const RESULT = { turnNumber: 0, moves: [MOVE], rackWords: ["CATS", "ACT"] };

const panel = (over: Partial<Parameters<typeof HintPanel>[0]> = {}) =>
  render(
    <HintPanel
      canAsk
      result={RESULT}
      loading={false}
      error={null}
      onAsk={vi.fn()}
      onPick={vi.fn()}
      {...over}
    />,
  );

describe("HintPanel", () => {
  test("tapping a card picks that move", () => {
    const onPick = vi.fn();
    panel({ onPick });
    fireEvent.click(screen.getByRole("button", { name: /39/ }));
    expect(onPick).toHaveBeenCalledWith(MOVE);
  });

  test("a rare word says so, and the reasons are shown", () => {
    panel();
    expect(screen.getByText(/rare/)).toBeTruthy();
    expect(screen.getByText(/closes a 3×3/)).toBeTruthy();
  });

  test("no play found says so", () => {
    panel({ result: { turnNumber: 0, moves: [], rackWords: [] } });
    expect(screen.getByText(/No play found/)).toBeTruthy();
  });

  test("the button waits while thinking, and is off when it is not your turn", () => {
    const { unmount } = panel({ loading: true, result: null });
    expect((screen.getByRole("button", { name: "Thinking…" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    panel({ canAsk: false, result: null });
    expect((screen.getByRole("button", { name: "Hint" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run src/components/HintPanel/HintPanel.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement HintPanel**

`src/components/HintPanel/HintPanel.tsx`:

```tsx
import type { HintMove, HintResult } from "../../../shared/sim/coach";
import { reasonsOf } from "../../lib/hintReasons";
import styles from "./HintPanel.module.css";

interface HintPanelProps {
  /** Your turn: the only time a hint is worth asking for. */
  canAsk: boolean;
  result: HintResult | null;
  loading: boolean;
  error: string | null;
  onAsk: () => void;
  onPick: (move: HintMove) => void;
}

/**
 * Hints in a practice game: a button, up to three plays to pick from, and the
 * words the rack spells. Picking a play stages it; Play is still yours.
 */
export function HintPanel({ canAsk, result, loading, error, onAsk, onPick }: HintPanelProps) {
  return (
    <section className={styles.panel} aria-label="Hints">
      <div className={styles.header}>
        <span className={styles.tag}>Practice</span>
        <button
          type="button"
          className={styles.ask}
          onClick={onAsk}
          disabled={!canAsk || loading}
        >
          {loading ? "Thinking…" : "Hint"}
        </button>
      </div>

      {error !== null && <p className={styles.error}>{error}</p>}

      {result !== null && result.moves.length === 0 && (
        <p className={styles.empty}>No play found for this rack. A swap might help.</p>
      )}

      {result?.moves.map((move, i) => {
        const reasons = reasonsOf(move);
        return (
          <button key={i} type="button" className={styles.card} onClick={() => onPick(move)}>
            <span className={styles.points}>{move.total}</span>
            <span className={styles.words}>
              {move.words.map((w, j) => (
                <span key={j} className={styles.word}>
                  {w.word}
                  {w.rare && <span className={styles.rare}>rare</span>}
                </span>
              ))}
            </span>
            {reasons.length > 0 && <span className={styles.reasons}>{reasons.join(" · ")}</span>}
          </button>
        );
      })}

      {result !== null && result.rackWords.length > 0 && (
        <details className={styles.rackWords}>
          <summary>Words in your rack</summary>
          <p>{result.rackWords.join(", ")}</p>
        </details>
      )}
    </section>
  );
}
```

`src/components/HintPanel/HintPanel.module.css`:

```css
.panel {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.tag {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--text);
  font-size: 0.8rem;
}

.ask {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--text-inverse);
  font: inherit;
  cursor: pointer;
}

.ask:hover:not(:disabled) {
  background: var(--accent-hover);
}

.ask:disabled {
  opacity: 0.5;
  cursor: default;
}

.card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
  align-items: baseline;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.card:hover {
  border-color: var(--border-strong);
}

.points {
  grid-row: span 2;
  font-size: 1.25rem;
  font-weight: 600;
}

.words {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.word {
  font-family: var(--font-tile);
}

.rare {
  margin-left: var(--space-1);
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.75rem;
}

.reasons {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.empty,
.error {
  margin: 0;
  font-size: 0.9rem;
}

.error {
  color: var(--danger);
}

.rackWords summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.rackWords p {
  margin: var(--space-2) 0 0;
  font-family: var(--font-tile);
}
```

- [ ] **Step 8: Run the panel test**

Run: `npx vitest run src/components/HintPanel/HintPanel.test.tsx`
Expected: PASS.

- [ ] **Step 9: Wire it into `Game.tsx`**

Imports:

```ts
import { useAction } from "convex/react";   // add to the existing convex/react import
import { HintPanel } from "../HintPanel/HintPanel";
import { shownHint, stageHint } from "../../lib/stageHint";
import { nearSquares } from "../../../shared/engine/nearSquares";
import type { HintMove, HintResult } from "../../../shared/sim/coach";
```

With the other hooks, next to `const rematch = useMutation(api.games.rematch);`:

```ts
  const askHints = useAction(api.coach.hints);
  const [hint, setHint] = useState<{
    result: HintResult | null;
    loading: boolean;
    error: string | null;
  }>({ result: null, loading: false, error: null });
```

Next to the `preview` memo (hooks must stay above the early `return`s for `view === undefined`):

```ts
  /** 3x3s this pending move leaves one tile short -- said aloud in practice games. */
  const leftOpen = useMemo(() => {
    if (!view || view.game.hints !== true || !boards || placements.length === 0) return 0;
    const shape = boardShapeNamed(view.layout, view.game.boardSize);
    return nearSquares(boards.before, placements, shape, view.game.boardSize).length;
  }, [view, boards, placements]);
```

After `const myTurn = ...` (below the early returns), plain functions:

```ts
  async function ask() {
    setHint((h) => ({ ...h, loading: true, error: null }));
    try {
      const result = await askHints({ gameId });
      setHint({ result, loading: false, error: null });
    } catch (err) {
      setHint({ result: null, loading: false, error: userMessage(err) });
    }
  }

  function pick(move: HintMove) {
    if (!me?.letters) return;
    const staged = stageHint(move.placements, me.letters);
    if (staged === null) {
      refuse("That hint no longer fits your rack.");
      return;
    }
    setSelected(null);
    setPending(staged);
  }
```

(`me`, `refuse`, `userMessage`, `setSelected`, `setPending` already exist in this file; check `refuse` is defined before this point, and move these two functions below it if not.)

Render, immediately before `{pending.length > 0 && (` / `<section className={styles.play}>`:

```tsx
        {game.hints === true && (
          <HintPanel
            canAsk={myTurn}
            result={shownHint(hint.result, game.turnNumber)}
            loading={hint.loading}
            error={hint.error}
            onAsk={() => void ask()}
            onPick={pick}
          />
        )}
```

Inside the play `<section>`, after the `This play scores` paragraph:

```tsx
            {leftOpen > 0 && (
              <p className={styles.warning}>Leaves a 3×3 one tile short for the next player.</p>
            )}
```

`src/components/Game/Game.module.css`, add:

```css
.warning {
  margin: var(--space-2) 0 0;
  color: var(--danger);
  font-size: 0.9rem;
}
```

- [ ] **Step 10: Typecheck, lint, test**

Run: `npm run typecheck && npx eslint src/components/Game src/components/HintPanel src/lib --max-warnings 0 && npx vitest run src`
Expected: clean, PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/stageHint.ts src/lib/stageHint.test.ts src/lib/hintReasons.ts src/lib/hintReasons.test.ts src/components/HintPanel src/components/Game/Game.tsx src/components/Game/Game.module.css
git commit -m "feat(coach): hint panel and 3x3 warning in practice games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The setup toggle and the lobby tag

**Files:**
- Modify: `src/components/CreateGame/CreateGame.tsx` (props, state, machines section, Start button)
- Modify: `src/components/Lobby/Lobby.tsx` (`startGame`, `onStart` handler, game rows)
- Modify: `src/components/Lobby/Lobby.module.css`
- Modify: `src/lib/useStartGame.ts` (`start`)

**Interfaces:**
- Consumes: `createGame`'s `hints` arg and `listMyGames` rows' `hints` (Task 2).
- Produces: `onStart(playerCount, friendIds, bots, isPublic, seat, hints)`.

- [ ] **Step 1: `useStartGame`**

Add a sixth parameter `hints = false` to `start`, and pass it: `createGame({ playerCount, bots: [...bots], isPublic, seat, hints })`.

- [ ] **Step 2: `CreateGame`**

In `CreateGameProps.onStart`, add `hints: boolean` after `seat: number`. Add state with the others:

```ts
  /** A practice game: hints on, counted toward nothing. Machines only. */
  const [hints, setHints] = useState(false);
```

In the `path === "machines"` section, after the `bots.map(...)` rows, add:

```tsx
            <label className={styles.row}>
              <input
                type="checkbox"
                checked={hints}
                onChange={(e) => setHints(e.target.checked)}
              />
              <span className={styles.name}>Allow hints (practice game)</span>
            </label>
            <p className={styles.hint}>Practice games don’t count toward your record.</p>
```

Start button: `onStart(count, [], bots, false, seat, hints)` for machines; `false` as the sixth argument on the other two calls.

- [ ] **Step 3: `Lobby`**

`startGame` gains `hints = false` as its sixth parameter and passes it to `start(...)`. The `onStart` prop becomes:

```tsx
            onStart={(playerCount, friendIds, bots, isPublic, seat, hints) =>
              void startGame(playerCount, friendIds, bots, isPublic, seat, hints)
            }
```

In the current-games rows and the past-games rows, inside the `<span className={styles.meta}>`, append:

```tsx
                  {g.hints && <span className={styles.practice}>Practice</span>}
```

`src/components/Lobby/Lobby.module.css`:

```css
.practice {
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--text);
  font-size: 0.75rem;
}
```

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npm run typecheck && npx eslint src --max-warnings 0 && npx vitest run --no-file-parallelism`
Expected: clean, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CreateGame/CreateGame.tsx src/components/Lobby/Lobby.tsx src/components/Lobby/Lobby.module.css src/lib/useStartGame.ts
git commit -m "feat(coach): practice toggle in setup, tag in the lobby

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Check it on the dev deployment (with the owner)

Deploying is outward-facing: ask before each step.

- [ ] **Step 1:** Ask, then push to dev: `npx convex dev --once`.
- [ ] **Step 2:** In the app, start a game against one hard bot with "Allow hints" on. Press Hint on the opening turn and on a mid-game turn with three blanks in hand. Note how long each took (the Convex dashboard logs show `coach:hints` durations).
- [ ] **Step 3:** Pick a hint and play it; confirm it plays. Press Hint, then play something else before it answers; confirm the late hint does not appear.
- [ ] **Step 4:** Finish or resign the game; confirm the profile's games played and best scores did not move, and the lobby shows "Practice" on it.
- [ ] **Step 5:** If any hint took more than about 3 seconds, lower `nodeLimit` in `shared/sim/coach.ts` (e.g. to 1,000), re-run `npx vitest run shared/sim/coach.test.ts convex/coach.test.ts`, and commit as `perf(coach): ...`.

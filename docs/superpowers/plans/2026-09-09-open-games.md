# Open Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player list a game with spare seats publicly, so a stranger with an account can find it and sit down — with everyone at such a table playing under a made-up name.

**Architecture:** One shared pool of legendary-people names serves both machines (prefixed `Robo-`) and the aliases humans hide behind in a public game. A single server-side view builder, `namesFor`, decides what name a given viewer may see for a given seat — real if it is their own or a friend's, alias otherwise — and every query that returns a player's name goes through it, so an unmasked name has nowhere to escape from.

**Tech Stack:** TypeScript, Convex (object-form functions, `convex-test` + Vitest), React 19 + Vite, CSS modules.

**Spec:** `docs/superpowers/specs/2026-09-09-open-games-design.md`

## Global Constraints

- Every name in the pool is **one word, a mortal person from legend**. No deities, no fae, no animal tricksters, nothing from a living faith. This rule governs any future addition to the pool.
- A machine's stored display name is exactly `` `Robo-${name} (${level})` `` — e.g. `Robo-Gawain (medium)`.
- Public listing is **opt-in per game**. A game is private unless `isPublic` was set at creation.
- **Account holders only** may join. `joinGame` already calls `refuseGuest(me)`; that stays.
- Joining a **public** game befriends nobody. Joining by link still befriends everyone at the table.
- Aliases are **per game**, never reused across games, and unique within a game.
- All new code is TypeScript. Convex functions use the object form (`query({ args, handler })`). Styling is CSS modules.
- Run tests with `npx vitest run <path>`. Typecheck with `./node_modules/.bin/tsc6 -b` (the binary is `tsc6`, not `tsc`).

**Correction to the spec:** the spec says `listOpenGames` returns "aliases only". That is wrong — a friend of yours can create a public game, and the agreed rule is that naming is a property of the pair, not of the surface. The open list uses the same `namesFor` builder as everything else, so a friend's game shows their real name there too. Task 5 implements it that way.

---

### Task 1: One name pool, machines prefixed

Replaces `BOT_NAMES` (40 modern first names) with a 56-name pool of legendary people shared by machines and aliases. Machines are told apart by a `Robo-` prefix rather than by having their own pool.

**Files:**
- Create: `shared/names.ts`
- Create: `shared/names.test.ts`
- Modify: `shared/config.ts` — delete the `BOT_NAMES` export (currently at the end of the difficulty section)
- Modify: `src/lib/roster.ts` — delete `drawBotNames`, keep `seatsSpare`
- Modify: `src/lib/roster.test.ts` — delete the "naming the machines" describe block, keep "seats a table of people still has spare"
- Modify: `convex/games.ts` — `BOT_NAMES` import, the name-pool check in `createGame`, and `seatBot`
- Modify: `src/components/CreateGame/CreateGame.tsx`, `src/components/Lobby/Lobby.tsx`, `src/components/GuestGame/GuestGame.tsx` — import site and call name
- Modify: `convex/games.test.ts`, `convex/bots.test.ts` — bot names in fixtures must come from the new pool

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `NAMES: readonly string[]` — the pool.
  - `drawNames(count: number, rng: () => number, taken?: Iterable<string>): string[]`
  - `robotName(name: string, level: string): string` — returns `` `Robo-${name} (${level})` ``
  - `ROBOT_PREFIX = "Robo-"`

- [ ] **Step 1: Write the failing tests**

Create `shared/names.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { drawNames, NAMES, robotName, ROBOT_PREFIX } from "./names";

/** A rigged rng: hands back the numbers given, then zeroes forever. */
const rigged = (...values: number[]) => {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
};

describe("the name pool", () => {
  test("is all one word, so a name fits a scoreboard row", () => {
    for (const name of NAMES) expect(name).not.toMatch(/\s/);
  });

  test("has no duplicates, or a draw could seat one name twice", () => {
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  test("is big enough that a full table has choices left", () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
  });
});

describe("drawing names", () => {
  test("draws the number asked for", () => {
    expect(drawNames(3, Math.random)).toHaveLength(3);
  });

  test("draws from the pool and nothing else", () => {
    for (const name of drawNames(3, Math.random)) expect(NAMES).toContain(name);
  });

  test("never draws one name twice", () => {
    for (let i = 0; i < 100; i++) {
      const drawn = drawNames(6, Math.random);
      expect(new Set(drawn).size).toBe(drawn.length);
    }
  });

  test("avoids the names already at the table", () => {
    const taken = NAMES.slice(0, NAMES.length - 1);
    expect(drawNames(1, Math.random, taken)).toEqual([NAMES[NAMES.length - 1]]);
  });

  test("the same rng draws the same names, so a test can pin them", () => {
    const draw = () => drawNames(2, rigged(0, 0));
    expect(draw()).toEqual(draw());
  });

  test("asking for more names than exist gives back every one, once", () => {
    const drawn = drawNames(NAMES.length + 5, Math.random);
    expect(new Set(drawn).size).toBe(NAMES.length);
  });
});

describe("what a machine is called", () => {
  test("wears the prefix, so no seat is mistaken for a person", () => {
    expect(robotName("Gawain", "medium")).toBe("Robo-Gawain (medium)");
  });

  test("the prefix is the one the pool check knows about", () => {
    expect(robotName("Egil", "hard").startsWith(ROBOT_PREFIX)).toBe(true);
  });

  test("no name in the pool already wears it", () => {
    for (const name of NAMES) expect(name.startsWith(ROBOT_PREFIX)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/names.test.ts`
Expected: FAIL — cannot resolve `./names`.

- [ ] **Step 3: Write the pool and the draw**

Create `shared/names.ts`:

```ts
/**
 * Names for the players nobody chose: the machines, and the people hiding
 * behind an alias in a public game.
 *
 * One pool for both, because two pools kept the kinds apart only by
 * convention -- "Sigurd" and "Robin" both read as a person's name -- and a
 * convention cannot be relied on by somebody reading a scoreboard. The
 * `Robo-` prefix can, so the prefix does that job and the pool does not.
 *
 * Every name is one word and a mortal person from legend: no deities, no fae,
 * no animal tricksters, and nothing from a living faith. Sources are public
 * domain and heroic rather than devotional -- an anonymous handle in a word
 * game is not a place to put somebody's god.
 */
export const NAMES = [
  // Arthurian
  "Gawain", "Bedivere", "Percival", "Igraine", "Morgause",
  "Tristan", "Isolde", "Lancelot", "Guinevere", "Galahad",
  // Norse sagas
  "Sigurd", "Gudrun", "Egil", "Ragnar", "Lagertha", "Gunnar",
  "Signy", "Grettir", "Hervor", "Aslaug", "Njal", "Hogni",
  // Shahnameh
  "Rostam", "Zal", "Tahmineh", "Sohrab", "Siyavash",
  "Rudabeh", "Manijeh", "Bijan", "Kaveh", "Gordafarid",
  // West and Central African epic
  "Sundiata", "Sogolon", "Fakoli", "Kolonkan",
  "Silamaka", "Poullori", "Nare", "Balla",
  // East Asian folklore
  "Mulan", "Momotaro", "Kintaro", "Urashima", "Gildong",
  "Chunhyang", "Ondal", "Benkei", "Tomoe", "Issun",
  // Beowulf and Old English
  "Wiglaf", "Hrothgar", "Unferth", "Scyld", "Hygelac", "Hildeburh",
] as const;

/** What marks a seat as a machine rather than a person. */
export const ROBOT_PREFIX = "Robo-";

/**
 * `count` names, drawn at random and never repeating.
 *
 * `taken` is for filling a table in stages -- the players already named keep
 * the names they were given, and this only picks the new ones. One draw
 * serves a whole game, so a machine and an aliased person can never end up
 * under the same name.
 *
 * The rng is passed in the way `gameName` takes one, so a test can pin a draw.
 */
export function drawNames(
  count: number,
  rng: () => number,
  taken: Iterable<string> = [],
): string[] {
  const spoken = new Set(taken);
  const pool = NAMES.filter((name) => !spoken.has(name));

  // Partial Fisher-Yates: swap a random survivor into each position in turn,
  // which draws without replacement however many are asked for.
  const drawn: string[] = [];
  for (let i = 0; i < pool.length && drawn.length < count; i++) {
    const pick = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[pick]] = [pool[pick], pool[i]];
    drawn.push(pool[i]);
  }
  return drawn;
}

/** What a machine plays under: the prefix says what it is, the level how good. */
export function robotName(name: string, level: string): string {
  return `${ROBOT_PREFIX}${name} (${level})`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run shared/names.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Delete the old pool and the old draw**

In `shared/config.ts`, delete the whole `BOT_NAMES` export together with its doc comment.

In `src/lib/roster.ts`, delete the `drawBotNames` function and its doc comment, and drop `BOT_NAMES` from the import so only `GAME` remains:

```ts
import { GAME } from "../../shared/config";
```

In `src/lib/roster.test.ts`, delete the `rigged` helper, the `describe("naming the machines", ...)` block, and the now-unused `BOT_NAMES` import. Keep `describe("seats a table of people still has spare", ...)` and its `GAME` import.

- [ ] **Step 6: Point every caller at the new module**

In `src/components/CreateGame/CreateGame.tsx`: replace the roster import with two, and rename both call sites of `drawBotNames` to `drawNames`.

```ts
import { seatsSpare } from "../../lib/roster";
import { drawNames } from "../../../shared/names";
```

In `src/components/Lobby/Lobby.tsx` and `src/components/GuestGame/GuestGame.tsx`: replace `import { drawBotNames } from "../../lib/roster";` with `import { drawNames } from "../../../shared/names";` and rename the call.

- [ ] **Step 7: Prefix the machines server-side**

In `convex/games.ts`, change the import:

```ts
import { NAMES, robotName } from "../shared/names.js";
```

...removing `BOT_NAMES` from the `shared/config.js` import list.

In `createGame`, the pool check becomes:

```ts
    for (const bot of bots) {
      if (!(NAMES as readonly string[]).includes(bot.name)) {
        throw new ConvexError("That is not a name a computer player can have");
      }
    }
```

In `seatBot`, the users row is written with the prefix:

```ts
  const userId = await ctx.db.insert("users", {
    authId: `bot|${gameId}|${seat}`,
    name: robotName(name, level),
  });
```

- [ ] **Step 8: Move the fixtures onto the new pool**

`"Sam"`, `"Ash"` and `"Robin"` are no longer in the pool, so every `createGame` call in the Convex tests that passes bots is now refused. In `convex/games.test.ts` and `convex/bots.test.ts`, replace them: `"Sam"` → `"Gawain"`, `"Ash"` → `"Sigurd"`, `"Robin"` → `"Rostam"`.

Two assertions also change. In `convex/games.test.ts`, the test named "a machine plays under the name it was set up with" expects the stored name — update both the name it passes and the name it expects:

```ts
      bots: [{ level: "hard", name: "Hervor" }],
    });

    const players = await seatsOf(t, gameId);
    const bot = await t.run(async (ctx) => ctx.db.get("users", players[1].userId));
    expect(bot?.name).toBe("Robo-Hervor (hard)");
```

The test named "a machine cannot be called something outside the pool" passes `"Alice"`, which is still outside the pool. Leave it.

- [ ] **Step 9: Verify the whole suite and the types**

Run: `./node_modules/.bin/tsc6 -b`
Expected: no output.

Run: `npx vitest run`
Expected: PASS, no failures. (`shared/sim/components.test.ts` has a wall-clock budget assertion that can fail on a loaded machine; if only that one fails, re-run it alone to confirm.)

- [ ] **Step 10: Commit**

```bash
git add shared/names.ts shared/names.test.ts shared/config.ts src/lib/roster.ts src/lib/roster.test.ts convex/games.ts convex/games.test.ts convex/bots.test.ts src/components/CreateGame/CreateGame.tsx src/components/Lobby/Lobby.tsx src/components/GuestGame/GuestGame.tsx
git commit -m "refactor(names): one pool of people, and machines wear Robo-"
```

---

### Task 2: Schema for a public game

**Files:**
- Modify: `convex/schema.ts` — the `games` table and the `players` table

**Interfaces:**
- Consumes: nothing.
- Produces: `games.isPublic?: boolean`, the index `by_public_and_status` on `["isPublic", "status"]`, and `players.alias?: string`.

- [ ] **Step 1: Add the fields and the index**

In `convex/schema.ts`, inside the `games` table definition, add after `createdBy`:

```ts
    /**
     * Listed for anyone with an account to find and join.
     *
     * Optional because every game made before open games predates it, and an
     * absent flag reads as private -- which is what those games are.
     */
    isPublic: v.optional(v.boolean()),
```

and change the table's index line from `.index("by_status", ["status"])` to:

```ts
  })
    .index("by_status", ["status"])
    // Public games still in their lobby, without reading every game ever
    // played to find them.
    .index("by_public_and_status", ["isPublic", "status"]),
```

In the `players` table, add after `bot`:

```ts
    /**
     * The name this seat plays under in a public game, where the people at
     * the table did not choose each other.
     *
     * Written for every human seat including the one that made the game, so
     * that no seat is the one without a disguise. Absent on a private game,
     * where nobody needs one, and absent on a machine's seat, which has no
     * identity to protect: a machine is its Robo- name to everybody.
     */
    alias: v.optional(v.string()),
```

- [ ] **Step 2: Verify the schema compiles and nothing broke**

Run: `./node_modules/.bin/tsc6 -b`
Expected: no output.

Run: `npx vitest run convex`
Expected: PASS. Both fields are optional, so every existing row still validates.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): a game can be public, and a seat can wear a name"
```

---

### Task 3: Creating a public game

**Files:**
- Modify: `convex/games.ts` — `createGame` args and handler, `joinSeat`
- Modify: `convex/games.test.ts` — new tests in the `describe` block that has the `table()` helper at line ~1239

**Interfaces:**
- Consumes: `drawNames` (Task 1), `games.isPublic` and `players.alias` (Task 2).
- Produces: `createGame` accepts `isPublic?: boolean`; a public game's human seats carry a unique `alias`; `joinSeat` accepts an optional `alias`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/games.test.ts`, inside the same `describe` block as `seatsOf` and `table()`:

```ts
  test("a public game gives every human seat a name to hide behind", async () => {
    const { t, asAlice } = await table();
    const { gameId } = await asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });

    const players = await seatsOf(t, gameId);
    expect(players).toHaveLength(1);
    expect(players[0].alias).toEqual(expect.any(String));
  });

  test("a private game hands out no aliases at all", async () => {
    const { t, asAlice } = await table();
    const { gameId } = await asAlice.mutation(api.games.createGame, {
      playerCount: 2,
    });

    const players = await seatsOf(t, gameId);
    expect(players[0].alias).toBeUndefined();
  });

  // One draw serves the whole table, so the machine's name is not free for a
  // person to hide behind.
  test("an alias never collides with a machine at the same table", async () => {
    const { t, asAlice } = await table();
    const { gameId } = await asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
      bots: [{ level: "easy", name: "Gawain" }],
    });

    const players = await seatsOf(t, gameId);
    const mine = players.find((p) => p.bot === undefined);
    expect(mine?.alias).not.toBe("Gawain");
  });

  test("a machine gets no alias -- it has nothing to hide", async () => {
    const { t, asAlice } = await table();
    const { gameId } = await asAlice.mutation(api.games.createGame, {
      playerCount: 2,
      isPublic: true,
      bots: [{ level: "easy", name: "Gawain" }],
    });

    const players = await seatsOf(t, gameId);
    expect(players.find((p) => p.bot !== undefined)?.alias).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run convex/games.test.ts`
Expected: FAIL — `isPublic` is not a valid argument (ArgumentValidationError), and `alias` is undefined.

- [ ] **Step 3: Accept the flag and draw the aliases**

In `convex/games.ts`, add to `createGame`'s args after `bots`:

```ts
    /**
     * Listed for strangers to find. Only meaningful on a game with a seat no
     * name is against yet -- a full table has nothing to offer anybody.
     */
    isPublic: v.optional(v.boolean()),
```

In the handler, after the bot-name check and before `ctx.db.insert("games", ...)`:

```ts
    // A game is only worth listing if somebody could take a seat at it.
    const isPublic = args.isPublic === true && args.playerCount - 1 - bots.length > 0;

    /*
     * The maker's own disguise. One name, not a table's worth: seats filled
     * later draw their own in `joinGame`, against the aliases already dealt.
     * Drawn around the machines' names so a table reads as several different
     * players rather than a Gawain beside a Robo-Gawain.
     */
    const alias = isPublic
      ? drawNames(1, Math.random, bots.map((b) => b.name))[0]
      : undefined;
```

Add `isPublic` to the inserted game document, beside `createdBy`:

```ts
      createdBy: userId,
      isPublic,
```

Change the creator's seat to carry the first alias:

```ts
    await joinSeat(ctx, gameId, userId, 0, "joined", alias);
```

- [ ] **Step 4: Let a seat carry an alias**

In `convex/games.ts`, extend `joinSeat`'s signature and its insert:

```ts
async function joinSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  userId: Id<"users">,
  seat: number,
  status: "invited" | "joined" = "joined",
  alias?: string,
) {
```

and in the `ctx.db.insert("players", { ... })` call, add after `seat`:

```ts
    alias,
```

Import `drawNames` alongside the names already imported from `../shared/names.js`:

```ts
import { drawNames, NAMES, robotName } from "../shared/names.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run convex/games.test.ts`
Expected: PASS, including the four new tests.

- [ ] **Step 6: Commit**

```bash
git add convex/games.ts convex/games.test.ts
git commit -m "feat(games): a game can be made public, and its seats get aliases"
```

---

### Task 4: The view builder, and every query through it

The privacy model is this one function. After this task no query returns a raw `displayName` for a player.

**Files:**
- Create: `convex/seats.ts`
- Modify: `convex/games.ts` — `getGame` (the `players:` block) and `listMyGames` (the `others`, `waitingFor` and `invitedBy` names)
- Modify: `convex/games.test.ts` — new `describe` block

**Interfaces:**
- Consumes: `players.alias`, `games.isPublic` (Task 2).
- Produces:
  - `friendIdsOf(ctx: QueryCtx, userId: Id<"users"> | null): Promise<Set<Id<"users">>>`
  - `namesFor(ctx: QueryCtx, viewerId: Id<"users"> | null, game: Doc<"games">, players: Doc<"players">[], friends: Set<Id<"users">>): Promise<Map<Id<"users">, string>>`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `convex/games.test.ts`. It needs a three-handed table, so it carries its own helper:

```ts
describe("who you are allowed to see", () => {
  /** Alice and Bob are friends. Carol is a stranger to both. */
  async function strangers() {
    const t = convexTest(schema, modules);
    const [alice, bob, carol] = await t.run(async (ctx) => {
      const a = await ctx.db.insert("users", { authId: "auth|alice", name: "Alice" });
      const b = await ctx.db.insert("users", { authId: "auth|bob", name: "Bob" });
      const c = await ctx.db.insert("users", { authId: "auth|carol", name: "Carol" });
      await ctx.db.insert("friendships", {
        requesterId: a,
        addresseeId: b,
        status: "accepted",
      });
      return [a, b, c];
    });
    return {
      t,
      alice,
      bob,
      carol,
      asAlice: t.withIdentity({ subject: "auth|alice" }),
      asBob: t.withIdentity({ subject: "auth|bob" }),
      asCarol: t.withIdentity({ subject: "auth|carol" }),
    };
  }

  /** A public three-hander made by Alice, with Bob and Carol sat down. */
  async function publicTable() {
    const seats = await strangers();
    const { gameId } = await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });
    await seats.asBob.mutation(api.games.joinGame, { gameId });
    await seats.asCarol.mutation(api.games.joinGame, { gameId });
    return { ...seats, gameId };
  }

  const nameOf = (
    view: { players: { userId: Id<"users">; name: string }[] } | null,
    userId: Id<"users">,
  ) => view?.players.find((p) => p.userId === userId)?.name;

  test("a stranger sees an alias, never a name", async () => {
    const { asCarol, gameId, alice, bob } = await publicTable();
    const view = await asCarol.query(api.games.getGame, { gameId });

    expect(nameOf(view, alice)).not.toBe("Alice");
    expect(nameOf(view, bob)).not.toBe("Bob");
  });

  test("a friend at the same table is still a friend", async () => {
    const { asAlice, gameId, bob, carol } = await publicTable();
    const view = await asAlice.query(api.games.getGame, { gameId });

    // Bob is Alice's friend, so no disguise between them.
    expect(nameOf(view, bob)).toBe("Bob");
    // Carol walked in off the list.
    expect(nameOf(view, carol)).not.toBe("Carol");
  });

  test("you are always yourself", async () => {
    const { asCarol, gameId, carol } = await publicTable();
    const view = await asCarol.query(api.games.getGame, { gameId });

    expect(nameOf(view, carol)).toBe("Carol");
  });

  test("two people at one table never share a disguise", async () => {
    const { asCarol, gameId, alice, bob } = await publicTable();
    const view = await asCarol.query(api.games.getGame, { gameId });

    expect(nameOf(view, alice)).not.toBe(nameOf(view, bob));
  });

  test("a private game is unchanged: everybody by name", async () => {
    const { asAlice, asBob, alice } = await strangers();
    const { gameId } = await asAlice.mutation(api.games.createGame, {
      playerCount: 2,
    });
    await asBob.mutation(api.games.joinGame, { gameId });

    const view = await asBob.query(api.games.getGame, { gameId });
    expect(nameOf(view, alice)).toBe("Alice");
  });

  test("a machine keeps its Robo- name for everyone", async () => {
    const seats = await strangers();
    const { gameId } = await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
      bots: [{ level: "easy", name: "Gawain" }],
    });
    await seats.asCarol.mutation(api.games.joinGame, { gameId });

    const view = await seats.asCarol.query(api.games.getGame, { gameId });
    expect(view?.players.map((p) => p.name)).toContain("Robo-Gawain (easy)");
  });

  test("the lobby disguises opponents too, not just the board", async () => {
    const { asCarol, gameId } = await publicTable();
    const lobby = await asCarol.query(api.games.listMyGames, {});

    const row = lobby.games.find((g) => g.gameId === gameId);
    expect(row?.opponents.map((o) => o.name)).not.toContain("Alice");
    expect(row?.opponents.map((o) => o.name)).not.toContain("Bob");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run convex/games.test.ts`
Expected: FAIL — real names come back, because nothing masks them yet.

- [ ] **Step 3: Write the view builder**

Create `convex/seats.ts`:

```ts
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { displayName } from "./auth_helpers";

/** Enough friendship rows to cover any table; a game seats four. */
const FRIEND_ROWS = 500;

/**
 * Who a viewer already knows.
 *
 * Loaded once per read rather than once per player: `getGame` is the hottest
 * query in the app -- every player, every turn, live -- and a friendship
 * lookup per seat would multiply that by the size of the table.
 */
export async function friendIdsOf(
  ctx: QueryCtx,
  userId: Id<"users"> | null,
): Promise<Set<Id<"users">>> {
  if (userId === null) return new Set();

  const [sent, received] = await Promise.all([
    ctx.db
      .query("friendships")
      .withIndex("by_requester", (q) => q.eq("requesterId", userId))
      .take(FRIEND_ROWS),
    ctx.db
      .query("friendships")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", userId))
      .take(FRIEND_ROWS),
  ]);

  const ids = new Set<Id<"users">>();
  for (const edge of sent) {
    if (edge.status === "accepted") ids.add(edge.addresseeId);
  }
  for (const edge of received) {
    if (edge.status === "accepted") ids.add(edge.requesterId);
  }
  return ids;
}

/**
 * The name a viewer is allowed to see for each seat at a game.
 *
 * This is the whole of the privacy model, in one place on purpose: every
 * query that returns a player goes through it, so an unmasked name has
 * nowhere to escape from. Masking inside each query instead would be four
 * places to get right today and every future query to remember, and a miss
 * is a real name handed to a stranger with nothing failing loudly.
 *
 * A name is real when the seat is the viewer's own, or belongs to somebody
 * they are already friends with -- knowing who they are is not something a
 * game can take back -- or to a machine, which has no identity to protect.
 * Everyone else is the alias their seat was dealt.
 */
export async function namesFor(
  ctx: QueryCtx,
  viewerId: Id<"users"> | null,
  game: Doc<"games">,
  players: Doc<"players">[],
  friends: Set<Id<"users">>,
): Promise<Map<Id<"users">, string>> {
  const names = new Map<Id<"users">, string>();

  for (const player of players) {
    const real = displayName(await ctx.db.get("users", player.userId));
    const disguised =
      game.isPublic === true &&
      player.bot === undefined &&
      player.userId !== viewerId &&
      !friends.has(player.userId);

    // A public seat with no alias predates aliases or was written wrong;
    // falling back to a real name would leak, so it falls back to nothing.
    names.set(player.userId, disguised ? (player.alias ?? "Player") : real);
  }

  return names;
}
```

- [ ] **Step 4: Route `getGame` through it**

In `convex/games.ts`, import at the top:

```ts
import { friendIdsOf, namesFor } from "./seats";
```

In `getGame`, after `const seated = players.filter(...)`:

```ts
    const friends = await friendIdsOf(ctx, userId);
    const names = await namesFor(ctx, userId, game, players, friends);
```

and replace the `players:` block so it reads the map instead of loading each user:

```ts
      players: players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        score: p.score,
        name: names.get(p.userId) ?? "Player",
        letters: p.userId === userId ? p.letters : null,
        letterCount: p.letters.length,
        blanks: blanksLeft(p),
        /** Asked, but not yet sitting down. */
        invited: p.status === "invited",
      })),
```

Note this drops the `await Promise.all(...)` and the per-player `ctx.db.get("users", ...)`, which `namesFor` now does instead. The `players:` value is no longer a promise, so remove the `await` in front of it.

- [ ] **Step 5: Route `listMyGames` through it**

In `listMyGames`, load the friend set once before the `Promise.all` over `mine`:

```ts
    const friends = await friendIdsOf(ctx, userId);
```

Inside the row builder, after `seated` is read, build the map for that game and take all three names from it:

```ts
        const names = await namesFor(ctx, userId, game, seated, friends);

        const others = seated
          .filter((other) => other.userId !== p.userId)
          .map((other) => ({
            name: names.get(other.userId) ?? "Player",
            pending: other.status === "invited",
          }));

        // Who the game is waiting on, by name: "your turn" answers the
        // question only when the answer is you.
        const inSeat = seated.find((other) => other.seat === game.currentSeat);
        const waitingFor =
          game.status !== "active" || inSeat === undefined
            ? null
            : (names.get(inSeat.userId) ?? "Player");
```

`others` is no longer a promise, so drop the `await Promise.all(...)` wrapper around it.

For `invitedBy`, the creator is a player at their own game, so the map covers them; keep `displayName(creator)` only as the fallback:

```ts
          invitedBy: names.get(game.createdBy) ?? displayName(creator),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run convex/games.test.ts`
Expected: PASS, including the seven new tests.

- [ ] **Step 7: Verify types and the whole suite**

Run: `./node_modules/.bin/tsc6 -b`
Expected: no output.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add convex/seats.ts convex/games.ts convex/games.test.ts
git commit -m "feat(privacy): one place decides what name a viewer may see"
```

---

### Task 5: The open list

**Files:**
- Modify: `convex/games.ts` — new `listOpenGames` query, placed next to `listMyGames`
- Modify: `convex/games.test.ts` — new tests in the `describe` block from Task 4

**Interfaces:**
- Consumes: `friendIdsOf`, `namesFor` (Task 4); the `by_public_and_status` index (Task 2).
- Produces: `api.games.listOpenGames` returning `{ games: { gameId, name, playerCount, seatsFilled, players: string[] }[] }`.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("who you are allowed to see", ...)` block in `convex/games.test.ts`:

```ts
  test("an open game is findable by a stranger", async () => {
    const seats = await strangers();
    const { gameId } = await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });

    const open = await seats.asCarol.query(api.games.listOpenGames, {});
    expect(open.games.map((g) => g.gameId)).toContain(gameId);
  });

  test("a private game with a spare seat is not", async () => {
    const seats = await strangers();
    await seats.asAlice.mutation(api.games.createGame, { playerCount: 3 });

    const open = await seats.asCarol.query(api.games.listOpenGames, {});
    expect(open.games).toHaveLength(0);
  });

  test("the list never says a stranger's real name", async () => {
    const seats = await strangers();
    await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });

    const open = await seats.asCarol.query(api.games.listOpenGames, {});
    expect(open.games[0].players).not.toContain("Alice");
  });

  // Naming is a property of the pair, not of the screen: Bob knows Alice
  // whether he meets her at the board or in a list.
  test("but it does say a friend's", async () => {
    const seats = await strangers();
    await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });

    const open = await seats.asBob.query(api.games.listOpenGames, {});
    expect(open.games[0].players).toContain("Alice");
  });

  test("a game with every seat taken drops off the list", async () => {
    const { asCarol, gameId } = await publicTable();

    const open = await asCarol.query(api.games.listOpenGames, {});
    expect(open.games.map((g) => g.gameId)).not.toContain(gameId);
  });

  test("a game you are already at is not offered to you again", async () => {
    const seats = await strangers();
    const { gameId } = await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });

    const open = await seats.asAlice.query(api.games.listOpenGames, {});
    expect(open.games.map((g) => g.gameId)).not.toContain(gameId);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run convex/games.test.ts`
Expected: FAIL — `api.games.listOpenGames` does not exist.

- [ ] **Step 3: Write the query**

In `convex/games.ts`, after `listMyGames`:

```ts
/** How many public games the open list reads, newest first. */
const OPEN_ROWS = 100;

/** A game nobody joined stops being an invitation after this long. */
const OPEN_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * Games with a seat spare that anybody may take.
 *
 * The one way into a game without knowing somebody first. Only games that
 * asked to be listed appear: a link sent to one person must not become a door
 * anyone can walk through.
 *
 * Names come from the same builder as everywhere else, so a stranger reads
 * aliases and a friend reads a friend -- who you are allowed to see is a fact
 * about the pair of you, not about which screen you are on.
 */
export const listOpenGames = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const friends = await friendIdsOf(ctx, userId);
    const fresh = Date.now() - OPEN_FOR_MS;

    const games = await ctx.db
      .query("games")
      .withIndex("by_public_and_status", (q) =>
        q.eq("isPublic", true).eq("status", "lobby"),
      )
      .order("desc")
      .take(OPEN_ROWS);

    const rows = await Promise.all(
      games.map(async (game) => {
        // A game nobody ever joined would otherwise sit in the list for good.
        if (game._creationTime < fresh) return null;

        const seated = await ctx.db
          .query("players")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .take(GAME.maxPlayers);

        if (seated.length >= game.playerCount) return null;
        // Your own games are in your lobby already.
        if (seated.some((p) => p.userId === userId)) return null;

        const names = await namesFor(ctx, userId, game, seated, friends);

        return {
          gameId: game._id,
          name: game.name ?? "Game",
          playerCount: game.playerCount,
          seatsFilled: seated.length,
          /** Who is waiting, as this viewer may see them. */
          players: seated.map((p) => names.get(p.userId) ?? "Player"),
        };
      }),
    );

    return { games: rows.filter((r) => r !== null) };
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run convex/games.test.ts`
Expected: PASS, including the six new tests.

- [ ] **Step 5: Commit**

```bash
git add convex/games.ts convex/games.test.ts
git commit -m "feat(games): a list of games with a seat going spare"
```

---

### Task 6: Joining a stranger's game

**Files:**
- Modify: `convex/games.ts` — `joinGame`
- Modify: `convex/games.test.ts` — new tests in the `describe` block from Task 4

**Interfaces:**
- Consumes: `drawNames` (Task 1), `joinSeat`'s `alias` parameter (Task 3).
- Produces: no new exports; `joinGame` behaviour changes for public games.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("who you are allowed to see", ...)` block:

```ts
  const friendshipsOf = (t: Awaited<ReturnType<typeof strangers>>["t"]) =>
    t.run(async (ctx) => ctx.db.query("friendships").take(50));

  test("sitting down with strangers does not make them friends", async () => {
    const { t, gameId } = await publicTable();

    // Only the Alice/Bob friendship the fixture starts with.
    expect(await friendshipsOf(t)).toHaveLength(1);
    expect(gameId).toBeDefined();
  });

  test("but joining by link still does", async () => {
    const { t, asAlice, asCarol } = await strangers();
    const { gameId } = await asAlice.mutation(api.games.createGame, {
      playerCount: 2,
    });
    await asCarol.mutation(api.games.joinGame, { gameId });

    expect(await friendshipsOf(t)).toHaveLength(2);
  });

  test("a stranger who joins gets a disguise of their own", async () => {
    const seats = await strangers();
    const { gameId } = await seats.asAlice.mutation(api.games.createGame, {
      playerCount: 3,
      isPublic: true,
    });
    await seats.asCarol.mutation(api.games.joinGame, { gameId });

    const players = await seats.t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .take(10),
    );
    const carol = players.find((p) => p.userId === seats.carol);
    const alice = players.find((p) => p.userId === seats.alice);

    expect(carol?.alias).toEqual(expect.any(String));
    expect(carol?.alias).not.toBe(alice?.alias);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run convex/games.test.ts`
Expected: FAIL — strangers are befriended, and the new seat has no alias.

- [ ] **Step 3: Draw an alias and skip the introductions**

In `convex/games.ts`, in `joinGame`, replace the `joinSeat` call and the
befriending loop with:

```ts
    /*
     * A seat at a public game comes with a name to wear, drawn against the
     * ones already dealt at this table so no two people share a disguise.
     *
     * Machines are not in that reckoning. A machine wears the prefix, so a
     * person drawn as Gawain sitting beside Robo-Gawain is still told apart
     * at a glance -- which is the whole reason for the prefix.
     */
    const alias =
      game.isPublic === true
        ? drawNames(
            1,
            Math.random,
            players
              .map((p) => p.alias)
              .filter((a): a is string => a !== undefined),
          )[0]
        : undefined;

    await joinSeat(ctx, args.gameId, userId, players.length, "joined", alias);

    /*
     * Sitting down together is itself the introduction, so no request is
     * needed: everyone already at the table becomes a friend, which is what
     * makes a second game possible without passing another link around.
     *
     * Not at a public game. There the link was a list anyone can read, and
     * the whole point of the aliases is that these people have not met.
     */
    if (game.isPublic !== true) {
      for (const other of players) {
        await befriend(ctx, userId, other.userId);
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run convex/games.test.ts`
Expected: PASS, including the three new tests, and the Task 4 and 5 tests still green.

- [ ] **Step 5: Verify the whole suite and the types**

Run: `./node_modules/.bin/tsc6 -b`
Expected: no output.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/games.ts convex/games.test.ts
git commit -m "feat(games): a stranger takes a seat under a name, and makes no friends"
```

---

### Task 7: Offering the game to strangers

**Files:**
- Modify: `src/components/CreateGame/CreateGame.tsx` — the people path
- Modify: `src/components/CreateGame/CreateGame.module.css` — the checkbox row
- Modify: `src/lib/useStartGame.ts` — `start` signature
- Modify: `src/components/Lobby/Lobby.tsx`, `src/components/Friends/Friends.tsx` — the `onStart` callbacks

**Interfaces:**
- Consumes: `createGame`'s `isPublic` argument (Task 3).
- Produces: `CreateGame`'s `onStart` gains a fourth parameter, `isPublic: boolean`; `useStartGame`'s `start` gains a fourth parameter, `isPublic?: boolean`.

- [ ] **Step 1: Widen the start path**

In `src/lib/useStartGame.ts`, add the parameter and pass it on:

```ts
  async function start(
    playerCount: number,
    friendIds: readonly Id<"users">[],
    bots: readonly BotSeat[] = [],
    isPublic = false,
  ): Promise<StartedGame | null> {
```

and in the mutation call:

```ts
      const game = await createGame({ playerCount, bots: [...bots], isPublic });
```

- [ ] **Step 2: Add the checkbox**

In `src/components/CreateGame/CreateGame.tsx`, add state beside `open`:

```ts
  /** Listed for strangers to find, rather than filled by a link you send. */
  const [listed, setListed] = useState(false);
```

Widen the prop type:

```ts
  onStart: (
    playerCount: number,
    friendIds: Id<"users">[],
    bots: BotSeat[],
    isPublic: boolean,
  ) => void;
```

In the people path, after the open-seat stepper row and before the `{!ready && ...}` hint:

```tsx
            {/*
              Only offered once a seat is actually open: a full table has
              nothing to list, and a checkbox that does nothing is a question
              you have to work out the answer to for no reason.
            */}
            {open > 0 && (
              <label className={styles.listRow}>
                <input
                  type="checkbox"
                  checked={listed}
                  onChange={() => setListed((on) => !on)}
                />
                <span className={styles.listText}>
                  Anyone can find and join these seats
                  <span className={styles.listHint}>
                    Everybody plays under a made-up name, yours included.
                  </span>
                </span>
              </label>
            )}
```

Because the checkbox is only reachable while a seat is open, a table that fills up must not stay listed. Pass the flag as `listed && open > 0` rather than `listed` alone, in the Start handler:

```tsx
            onClick={() =>
              path === "machines"
                ? onStart(count, [], bots, false)
                : path === "alone"
                  ? onStart(1, [], [], false)
                  : onStart(people, picked, [], listed && open > 0)
            }
```

- [ ] **Step 3: Style the row**

In `src/components/CreateGame/CreateGame.module.css`, after the `.openCount` rule:

```css
/*
 * Listing the game, under the seats it would list. A row rather than a line
 * of text, because it is a question with an answer rather than an action --
 * and the consequence is spelled out under it, since "anyone" is the part
 * somebody might not have thought about.
 */
.listRow {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) 0 0;
  cursor: pointer;
}

.listText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.9rem;
}

.listHint {
  color: var(--text-muted);
  font-size: 0.8rem;
}
```

- [ ] **Step 4: Update the two callers**

In `src/components/Lobby/Lobby.tsx`, widen `startGame` and pass it through:

```ts
  async function startGame(
    playerCount: number,
    friendIds: Id<"users">[],
    bots: BotSeat[],
    isPublic = false,
  ) {
    const game = await start(playerCount, friendIds, bots, isPublic);
```

and the `CreateGame` element:

```tsx
            onStart={(playerCount, friendIds, bots, isPublic) =>
              void startGame(playerCount, friendIds, bots, isPublic)
            }
```

In `src/components/Friends/Friends.tsx`, the same shape:

```ts
  async function startWith(
    playerCount: number,
    friendIds: Id<"users">[],
    bots: BotSeat[],
    isPublic = false,
  ) {
    const game = await start(playerCount, friendIds, bots, isPublic);
```

```tsx
          onStart={(playerCount, friendIds, bots, isPublic) =>
            void startWith(playerCount, friendIds, bots, isPublic)
          }
```

- [ ] **Step 5: Verify types and build**

Run: `./node_modules/.bin/tsc6 -b`
Expected: no output.

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/CreateGame/CreateGame.tsx src/components/CreateGame/CreateGame.module.css src/lib/useStartGame.ts src/components/Lobby/Lobby.tsx src/components/Friends/Friends.tsx
git commit -m "feat(ui): a game with a spare seat can offer it to anyone"
```

---

### Task 8: Finding a game to join

**Files:**
- Modify: `src/components/Lobby/Lobby.tsx` — a new section
- Modify: `src/components/Lobby/Lobby.module.css` — the row

**Interfaces:**
- Consumes: `api.games.listOpenGames` (Task 5), `api.games.joinGame`.
- Produces: nothing.

- [ ] **Step 1: Read the list and offer a way in**

In `src/components/Lobby/Lobby.tsx`, alongside the other queries:

```ts
  const openGames = useQuery(api.games.listOpenGames);
  const joinGame = useMutation(api.games.joinGame);
```

and a handler beside `startGame`:

```ts
  /** Take a seat at a game somebody left open. */
  async function joinOpen(gameId: Id<"games">) {
    try {
      await joinGame({ gameId });
      onOpen(gameId);
    } catch (err) {
      setJoinError(userMessage(err));
    }
  }
```

with its state and import:

```ts
  const [joinError, setJoinError] = useState<string | null>(null);
```

```ts
import { userMessage } from "../../lib/errors";
```

Then the section, placed after the `Invitations` section:

```tsx
      {(openGames?.games.length ?? 0) > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Open games</h2>
          {/*
            Games nobody you know made. The people at them are named as this
            viewer may see them -- an alias for a stranger, a name for a
            friend -- which is decided on the server, not here.
          */}
          {openGames?.games.map((g) => (
            <div key={g.gameId} className={styles.row}>
              <span className={styles.grow}>
                {g.name}
                <span className={styles.openWith}>
                  {g.players.join(", ")} · {g.seatsFilled} of {g.playerCount}
                </span>
              </span>
              <button
                type="button"
                className={styles.join}
                onClick={() => void joinOpen(g.gameId)}
              >
                Join
              </button>
            </div>
          ))}
          {joinError !== null && <p className={styles.error}>{joinError}</p>}
        </section>
      )}
```

- [ ] **Step 2: Style the row**

In `src/components/Lobby/Lobby.module.css`, add:

```css
/* Who is already sitting there, under the game's name. */
.openWith {
  display: block;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.join {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-3);
  font-size: 0.85rem;
  font-weight: 600;
}

.join:hover {
  background: var(--accent);
  color: var(--text-inverse);
}
```

If `.error` does not already exist in this stylesheet, add:

```css
.error {
  margin: var(--space-2) 0 0;
  color: var(--danger);
  font-size: 0.85rem;
}
```

- [ ] **Step 3: Verify types and build**

Run: `./node_modules/.bin/tsc6 -b`
Expected: no output.

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Run the whole suite one last time**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Lobby/Lobby.tsx src/components/Lobby/Lobby.module.css
git commit -m "feat(ui): the lobby shows games with a seat going spare"
```

---

## What this plan does not do

Both are in the spec as known gaps, deliberately unbuilt:

- **Abandonment.** A stranger can join and never take a turn. The existing resign path is the only answer and it needs a human to press it.
- **Report or block.** A public list eventually needs one.

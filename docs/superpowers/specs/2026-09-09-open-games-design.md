# Open games — design

Date: 2026-09-09

## Problem

A seat in a game can only be filled by somebody you already know. Either you
tick a friend, or you send the link — and the link is the permission, since
there is no public list to find a game in (`joinGame`, convex/games.ts).

So a person with nobody to play has nothing to press. A game with a spare
seat sits in a lobby that only its creator can see, and the way to find an
opponent is to already have one.

An open list fixes that and introduces a problem the app has never had:
strangers. Everything about the game today assumes the people at a table know
each other. `joinGame` befriends everybody at the table on sitting down.
`getGame` hands every seated player the real name of every other. Both are
correct for a link passed between people who know each other and wrong the
moment a seat is filled by somebody who found it in a list.

## What we are building

A game can be listed publicly. Anyone with an account can find it and take a
seat. Everybody at such a game plays under a made-up name, and joining one
does not make anybody your friend.

## Decisions

Settled in brainstorming, with the reasoning, since the reasoning is what will
be re-litigated:

**Listing is opt-in, per game.** A checkbox beside the open-seat stepper. A
game with a spare seat is not public unless it was asked to be — a link you
sent to one person must not become a door anyone can walk through.

**A public game is aliased for its whole life,** in the list, at the board,
and after it has finished. Not "aliased until you sit down": you cannot decide
whether to meet somebody after you have already met them.

**A fresh alias per game.** Two games against the same person do not link up.
A stable handle would let strangers recognise each other, which is pleasant
right up until it is the reason somebody cannot get away from someone.

**Friends are exempt, per viewer.** A public game can still contain a friend
you picked by name. You see them by name because you already know who they
are; a stranger at the same table sees you both as aliases, and you both see
the stranger as one. Naming is a property of the pair, not of the game.

**Joining a public game befriends nobody.** The auto-friending in `joinGame`
is right for a link — sitting down together really is the introduction when
the link came from someone you know. It is wrong for a stranger.

**Account holders only.** `joinGame` already refuses guests and keeps doing
so. An open game is strangers relying on each other to take turns, and a
guest account is the easiest thing in the app to walk away from.

## The name pool

One pool of names, shared by machines and by the people hiding behind an
alias, with machines marked by a `Robo-` prefix: `Robo-Gawain (medium)` is a
computer, `Gawain` is a person. The prefix is what separates the two kinds of
player, so the pool does not have to.

This replaces `BOT_NAMES`, the forty modern first names machines currently
draw from. The reason to give it up: "Sigurd" and "Robin" both read as a
person's name, so two pools kept the kinds apart only by convention, and a
convention cannot be relied on by somebody reading a scoreboard. A prefix can.

The names are one word, **people from legend** — mortals in the stories, not
gods.

Sources are public domain and heroic rather than devotional: Arthurian
(Gawain, Bedivere, Igraine, Percival), Norse sagas (Sigurd, Brynhild, Egil,
Gudrun), the Shahnameh (Rostam, Zal, Tahmineh, Siyavash), West and Central
African epic (Sundiata, Sogolon, Fakoli, Mwindo), East Asian folklore (Mulan,
Momotaro, Kintaro, Gildong), Beowulf (Wiglaf, Hrothgar, Unferth).

Two exclusions, both deliberate:

- **No deities, and no fae or animal tricksters** — Odin and Thor, but also
  Titania, Anansi and Wukong. The pool is people.
- **Nothing from a living faith.** Orishas and Hindu deities are out of
  copyright and still worshipped. An anonymous handle in a word game is not
  where they belong.

Around 60 names, short enough that `Robo-Hrothgar (medium)` still fits a
scoreboard row beside a score.

`shared/names.ts` exports the pool and `drawNames(count, rng, taken)` —
`drawBotNames` renamed and moved, drawing without replacement and skipping
names already at the table. One draw serves a whole game, so a machine and an
aliased person can never end up under the same name.

The stored name keeps its shape: the prefix and the level are written into
the `users` row when the machine is seated, as `(level)` is today. The level
suffix stays — the prefix says a seat is a machine, the suffix says how good
a machine, and both are worth knowing mid-game.

## Data model

`games`:

- `isPublic: v.optional(v.boolean())` — listed for anyone to find. Optional
  because every existing game predates it, and absent reads as private, which
  is what those games are.
- Index `by_public_and_status` on `["isPublic", "status"]`, for listing public
  games still in their lobby without scanning every game ever played.

`players`:

- `alias: v.optional(v.string())` — the name this seat plays under. Written
  when the seat is created in a public game, for **every** human seat
  including the creator's, so that no seat is the one without a disguise.
  Absent on private games, where nobody needs one, and absent on a machine's
  seat, which has no identity to protect: a machine is its `Robo-` name to
  everybody, in every game.

## Server

### The view builder

The whole privacy model is one function. Everything that returns a player goes
through it, so an unmasked name has nowhere to escape from:

```ts
async function seatsFor(ctx, viewerId, game, players): Promise<Seat[]>
```

For each player it returns the seat as the viewer may see it, where the name
is the real one when the seat is the viewer's own or belongs to a friend of
the viewer, and the alias otherwise. On a private game every name is real, as
now.

The viewer's friend ids are loaded **once** per call, not once per player:
`getGame` is the hottest query in the app — every player, every turn, live.

Callers: `getGame`, `listMyGames` and `listOpenGames` — which is all of them.
`displayName` appears nowhere else outside `friends.ts`, and the end-of-game
recap is rendered client-side from what `getGame` already returned.

Approach considered and rejected: masking inside each query. Four places to
get right today, every future name-returning query to remember, and a miss is
a real name sent to a stranger with nothing failing loudly.

Also rejected: seating public players under throwaway `users` rows the way
bots are. Every existing query would work untouched, but scores, wins and "my
games" would attach to the alias instead of the person.

### Changes to existing functions

`createGame` takes `isPublic`, meaningful only when the game has a seat no
name is against. It draws an alias for each seat it creates.

`joinGame` draws an alias for the seat it fills when the game is public, and
**skips the befriending loop** for those games. Link games keep it.

### New query

`listOpenGames` — public games still in their lobby with at least one seat
free, newest first, capped. Returns the game's name, seats filled of total,
and the names this viewer may see, from the same builder as everywhere else.
Usually that means aliases, since the viewer is not at that table -- but a
friend who made a public game is still shown by name, because who you may see
is a fact about the pair of you and not about which screen you are on.

Only games created recently are listed, so one that nobody ever joins falls
out of the list rather than sitting in it forever.

## Client

**CreateGame**, people path: a checkbox under the open-seat stepper, live only
when at least one seat is open — "Anyone can find and join these seats.
Everyone plays under a made-up name." Passed through `useStartGame` to
`createGame`.

**Lobby**: an "Open games" section listing what `listOpenGames` returns, each
row with a Join button.

## Testing

convex-test, against the leak cases rather than the happy path:

- A stranger reading a public game gets aliases for every other seat.
- A friend at that same table gets the friend's real name, and the stranger's
  alias, from the same query.
- `listOpenGames` never returns a real name, for any viewer.
- Joining a public game creates no friendship; joining by link still does.
- Aliases do not repeat within a game.
- A game whose last seat is taken leaves the open list.
- A private game is unchanged: every name real, befriending intact.
- A machine at a public table keeps its `Robo-` name for every viewer.
- Names drawn for one game never collide across machines and aliases.

The `drawBotNames` unit tests carry over to `drawNames` unchanged in shape:
in-pool, no repeats, honours `taken`, deterministic under a rigged rng.

The server-side check that a machine's name comes from the pool, added with
per-game bot names, now checks the new pool. Games already played keep the
names stored on their `users` rows; nothing reads the pool to render them.

## Known gaps

**Abandonment.** A stranger can join and never take a turn, and the only
answer is the existing resign path, which needs a human to press it. This is
the first thing that will hurt, and it is not fixed here.

**No report or block.** A public list eventually needs one. Out of v1.

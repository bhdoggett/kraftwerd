import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { displayName } from "./auth_helpers";

/**
 * How much of the viewer's own friend list is read, in each direction.
 *
 * It bounds the viewer's friendships, not the table -- a game seats four, but
 * the question being answered is "who does this person already know", and that
 * list is as long as they have made it. Past the cap the tail is unread, so a
 * genuine friend beyond it would start appearing under an alias: the failure
 * is over-masking, never a real name shown to a stranger, which is the right
 * way round for a privacy chokepoint to break.
 *
 * It disagrees with `MAX_FRIENDS = 200` in `convex/friends.ts`, which is the
 * number the app treats as anybody's real limit. 500 is slack on purpose so
 * that the two caps disagreeing costs nothing here; if the friends cap ever
 * rises above this one, this is the line to raise with it.
 */
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
 *
 * A machine's seat carries an alias too, but it is never consulted: the
 * `bot === undefined` test comes first, so a machine renders as its `Robo-`
 * name to everybody. The field is there so that every draw excludes the
 * machines' names by the same mechanism it excludes people's -- bookkeeping,
 * not a disguise.
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
    const disguised =
      game.isPublic === true &&
      player.bot === undefined &&
      player.userId !== viewerId &&
      !friends.has(player.userId);

    if (disguised) {
      // A public seat with no alias predates aliases or was written wrong;
      // falling back to a real name would leak, so it falls back to nothing.
      names.set(player.userId, player.alias ?? "Player");
      continue;
    }

    // Read only now that the answer is known to be the real name. Fetching it
    // first and discarding it worked, but a chokepoint that loads names it has
    // decided to hide is one edit away from handing one out by accident.
    names.set(
      player.userId,
      displayName(await ctx.db.get("users", player.userId)),
    );
  }

  return names;
}

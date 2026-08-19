import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const gameStatus = v.union(
  v.literal("lobby"),
  v.literal("active"),
  v.literal("finished"),
);

export const placement = v.object({
  x: v.number(),
  y: v.number(),
  letter: v.string(),
  isBlank: v.boolean(),
});

export default defineSchema({
  /**
   * App-level mirror of the Better Auth user, kept in sync by the triggers in
   * `auth.ts`. Game documents reference this row, not the component's, so the
   * game schema does not depend on the auth provider.
   */
  users: defineTable({
    /** The Better Auth user id, which is also the JWT subject. */
    authId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    /**
     * Lifetime stats. Optional because rows created before stats existed have
     * none, and an absent count reads the same as zero.
     */
    wins: v.optional(v.number()),
    gamesPlayed: v.optional(v.number()),
    /** Best final score in a single game. */
    bestGameScore: v.optional(v.number()),
    /** Best score from one turn. */
    bestTurnScore: v.optional(v.number()),
  })
    .index("by_authId", ["authId"])
    .index("by_email", ["email"]),

  games: defineTable({
    /** A generated name, so games are tellable apart at a glance. */
    name: v.optional(v.string()),
    status: gameStatus,
    boardSize: v.number(),
    /** Which hand-drawn layout this game is played on (shared/boards.ts). */
    layout: v.optional(v.string()),
    /** Game ends once this many tiles are on the board (design.md §6). */
    endThreshold: v.number(),
    playerCount: v.number(),
    /** Seat whose turn it is; seats are 0..playerCount-1. */
    currentSeat: v.number(),
    /** Increments once per play, across all players. */
    turnNumber: v.number(),
    /** Denormalised: Convex has no count operator, and §6 reads this often. */
    tileCount: v.number(),
    /**
     * Set the moment `tileCount` crosses `endThreshold`. The game finishes
     * after this turn, so the round completes and every player has had an
     * equal number of turns (design.md §6).
     */
    endsAfterTurn: v.optional(v.number()),
    /**
     * Turns in a row where nobody placed a tile. Letters never run out, so
     * without this a table that keeps trading would never reach the threshold
     * that ends a game.
     */
    consecutivePasses: v.optional(v.number()),
    /** Set when the game finishes; ties give every leader a win. */
    winnerIds: v.optional(v.array(v.id("users"))),
    /** Players who quit. They forfeit and cannot win. */
    resignedBy: v.optional(v.array(v.id("users"))),
    createdBy: v.id("users"),
  }).index("by_status", ["status"]),

  /** One row per player per game: seat, score, and their private rack. */
  players: defineTable({
    gameId: v.id("games"),
    userId: v.id("users"),
    seat: v.number(),
    score: v.number(),
    letters: v.array(v.string()),
    /** The single blank slot, refilled every turn (design.md §5). */
    blank: v.boolean(),
    /**
     * "invited" until the player accepts. Optional because rows created before
     * invitations existed are all seated players; absent reads as "joined".
     */
    status: v.optional(v.union(v.literal("invited"), v.literal("joined"))),
  })
    .index("by_game", ["gameId"])
    .index("by_game_and_user", ["gameId", "userId"])
    .index("by_game_and_seat", ["gameId", "seat"])
    .index("by_user", ["userId"]),

  /**
   * A friendship, stored as a single row rather than one per direction.
   * `requesterId` sent it, `addresseeId` accepts or declines. Both ids are
   * indexed so either side can list their own.
   */
  friendships: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
  })
    .index("by_requester", ["requesterId"])
    .index("by_addressee", ["addresseeId"])
    .index("by_pair", ["requesterId", "addresseeId"]),

  /**
   * One row per placed tile. A tiles array on the game document would hit the
   * 1MB limit and rewrite the whole board on every play.
   */
  tiles: defineTable({
    gameId: v.id("games"),
    x: v.number(),
    y: v.number(),
    letter: v.string(),
    isBlank: v.boolean(),
    placedBy: v.id("users"),
    turnNumber: v.number(),
  })
    .index("by_game", ["gameId"])
    .index("by_game_and_position", ["gameId", "x", "y"]),

  /** Turn history, for replay and for showing what the last player scored. */
  turns: defineTable({
    gameId: v.id("games"),
    turnNumber: v.number(),
    userId: v.id("users"),
    placements: v.array(placement),
    words: v.array(v.string()),
    squares: v.array(v.number()),
    score: v.number(),
  }).index("by_game_and_turn", ["gameId", "turnNumber"]),

  /**
   * The dictionary, loaded via `npx convex import` rather than bundled: 59k
   * words is far too much to ship inside a function module.
   */
  words: defineTable({
    word: v.string(),
  }).index("by_word", ["word"]),
});

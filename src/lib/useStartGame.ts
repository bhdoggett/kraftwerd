import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Difficulty } from "../../shared/config";
import { userMessage } from "./errors";

export interface StartedGame {
  gameId: Id<"games">;
  name: string;
  playerCount: number;
}

/**
 * Making a game and asking the chosen friends to it.
 *
 * Shared, because starting a game is now reachable from two places — the
 * lobby's button and a friend's Play button — and they were drifting: one
 * created the game and invited in two steps, the other used a mutation that
 * did both but could only make a game whose seats were all spoken for.
 */
export function useStartGame() {
  const createGame = useMutation(api.games.createGame);
  const inviteToGame = useMutation(api.games.inviteToGame);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(
    playerCount: number,
    friendIds: readonly Id<"users">[],
    bots: readonly Difficulty[] = [],
  ): Promise<StartedGame | null> {
    setError(null);
    setStarting(true);
    try {
      // Machines are seated by createGame itself, before the invitations go
      // out: they take the seats next to yours, and the people asked take
      // what is left. The order is what makes the name shown while setting
      // the game up the name that ends up playing.
      const game = await createGame({ playerCount, bots: [...bots] });
      if (friendIds.length > 0) {
        await inviteToGame({ gameId: game.gameId, friendIds: [...friendIds] });
      }
      return game;
    } catch (err) {
      setError(userMessage(err));
      return null;
    } finally {
      setStarting(false);
    }
  }

  return { start, starting, error, clearError: () => setError(null) };
}

/** The game a guest asked for on the way in. */
export type PromisedGame = "solo" | "computer";

/**
 * What a guest asked for before they had an account.
 *
 * Set as the guest account is made and read once the lobby has loaded under
 * it. It travels through sessionStorage rather than through props because
 * signing in swaps the whole tree: the button that made the promise is gone
 * by the time there is an account to keep it with.
 */
const GUEST_START = "kraftwerd:play-first";

export function promiseAGame(kind: PromisedGame) {
  try {
    window.sessionStorage.setItem(GUEST_START, kind);
  } catch {
    // Private browsing: they land in the lobby and press New game, which is
    // one press more than they were promised and no worse than that.
  }
}

/** Claims that promise, and says what was asked for. */
export function claimPromisedGame(): PromisedGame | null {
  try {
    const kind = window.sessionStorage.getItem(GUEST_START);
    if (kind !== "solo" && kind !== "computer") return null;
    window.sessionStorage.removeItem(GUEST_START);
    return kind;
  } catch {
    return null;
  }
}

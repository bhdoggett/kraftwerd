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

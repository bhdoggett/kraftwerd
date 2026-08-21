import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
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
  ): Promise<StartedGame | null> {
    setError(null);
    setStarting(true);
    try {
      const game = await createGame({ playerCount });
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

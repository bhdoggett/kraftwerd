import type { GameResult } from "./GameOver";

/** The headline: who won, said the way the viewer would say it. */
export function headline(result: Pick<GameResult, "youWon" | "winners">) {
  const { youWon, winners } = result;
  if (youWon) return winners.length > 1 ? "You tied for the win!" : "You won!";
  if (winners.length === 0) return "Game over";
  if (winners.length === 1) return `${winners[0]} won`;
  return `${winners.slice(0, -1).join(", ")} and ${winners[winners.length - 1]} tied`;
}

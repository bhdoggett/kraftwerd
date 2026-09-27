import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../Modal/Modal";
import styles from "./GameOver.module.css";

export interface GameResult {
  gameId: Id<"games">;
  youWon: boolean;
  winners: string[];
  scores: { name: string; score: number; you: boolean }[];
}

/** The headline: who won, said the way the viewer would say it. */
export function headline(result: Pick<GameResult, "youWon" | "winners">) {
  const { youWon, winners } = result;
  if (youWon) return winners.length > 1 ? "You tied for the win!" : "You won!";
  if (winners.length === 0) return "Game over";
  if (winners.length === 1) return `${winners[0]} won`;
  return `${winners.slice(0, -1).join(", ")} and ${winners[winners.length - 1]} tied`;
}

interface GameOverDialogProps {
  result: GameResult;
  onView: () => void;
  onClose: () => void;
}

export function GameOverDialog({ result, onView, onClose }: GameOverDialogProps) {
  return (
    <Modal onDismiss={onClose}>
      <div className={styles.body}>
        <h2 className={styles.title}>{headline(result)}</h2>
        <ol className={styles.scores}>
          {result.scores.map((row, i) => (
            <li key={i} className={row.you ? styles.you : undefined}>
              <span>{row.you ? "You" : row.name}</span>
              <span className={styles.score}>{row.score}</span>
            </li>
          ))}
        </ol>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Close
          </button>
          <button type="button" className={styles.button} onClick={onView}>
            View results
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Says how a game came out, once, wherever you are in the app.
 *
 * A finished game used to go straight into the lobby's past games, so a result
 * you were not watching for arrived as a row you had to notice. This shows the
 * oldest result you have not been told, and dismissing it either way marks it
 * seen on your account (`seeResult`), so it does not come back on another
 * device.
 */
export function GameOverNotice({
  currentGameId,
  onOpen,
}: {
  /** The game on screen, if any: viewing its results is just closing this. */
  currentGameId: string | null;
  onOpen: (gameId: Id<"games">) => void;
}) {
  const pending = useQuery(api.games.pendingResults);
  const seeResult = useMutation(api.games.seeResult);

  const result = pending?.[0];
  if (result === undefined) return null;

  const seen = () => void seeResult({ gameId: result.gameId });

  return (
    <GameOverDialog
      // Keyed so the next result, if there is one, opens fresh.
      key={result.gameId}
      result={result}
      onClose={seen}
      onView={() => {
        seen();
        if (currentGameId !== result.gameId) onOpen(result.gameId);
      }}
    />
  );
}

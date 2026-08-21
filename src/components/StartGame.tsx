import { useState } from "react";
import { GAME } from "../../shared/config";
import type { Id } from "../../convex/_generated/dataModel";
import { Modal } from "./Modal";
import styles from "./StartGame.module.css";

export interface Player {
  userId: Id<"users">;
  name: string;
}

interface StartGameProps {
  /** The friend whose Play button was pressed. Always in the game. */
  friend: Player;
  /** Everyone else who could be asked along. */
  others: readonly Player[];
  onStart: (friendIds: Id<"users">[]) => void;
  onCancel: () => void;
  starting: boolean;
  error: string | null;
}

/**
 * Who else is coming, asked before the game exists.
 *
 * Play used to make a two-player game on the spot, and a game's size is fixed
 * when it is created — so wanting a third meant abandoning the game and
 * starting again from the friends list.
 */
export function StartGame({
  friend,
  others,
  onStart,
  onCancel,
  starting,
  error,
}: StartGameProps) {
  const [picked, setPicked] = useState<Id<"users">[]>([]);

  // The two of you already hold two of the seats.
  const spare = GAME.maxPlayers - 2;
  const full = picked.length >= spare;

  const toggle = (userId: Id<"users">) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : full
          ? current
          : [...current, userId],
    );

  const players = picked.length + 2;

  return (
    <Modal onDismiss={starting ? undefined : onCancel}>
      <div className={styles.body}>
        <div>
          <h2 className={styles.title}>Play {friend.name}</h2>
          <p className={styles.subtitle}>
            {others.length === 0
              ? "Just the two of you — nobody else on your friends list yet."
              : `Ask anyone else along, up to ${GAME.maxPlayers} players in total.`}
          </p>
        </div>

        {others.length > 0 && (
          <div>
            <h3 className={styles.heading}>Anyone else?</h3>
            {others.map((other) => (
              <div key={other.userId} className={styles.row}>
                <input
                  type="checkbox"
                  checked={picked.includes(other.userId)}
                  disabled={full && !picked.includes(other.userId)}
                  onChange={() => toggle(other.userId)}
                  aria-label={`Include ${other.name}`}
                />
                <span className={styles.name}>{other.name}</span>
              </div>
            ))}
          </div>
        )}

        {error !== null && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={onCancel}
            disabled={starting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => onStart([friend.userId, ...picked])}
            disabled={starting}
          >
            {starting ? "Starting…" : `Start ${players}-player game`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

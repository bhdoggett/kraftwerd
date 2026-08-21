import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GAME } from "../../shared/config";
import { Modal } from "./Modal";
import styles from "./CreateGame.module.css";

interface CreateGameProps {
  onStart: (playerCount: number, friendIds: Id<"users">[]) => void;
  onCancel: () => void;
  starting: boolean;
  error: string | null;
  /**
   * Someone already chosen — the friend whose Play button was pressed. They
   * start ticked, and the game starts at two players rather than one.
   */
  withFriend?: Id<"users">;
}

const COUNTS = Array.from({ length: GAME.maxPlayers }, (_, i) => i + 1);

/**
 * Everything about starting a game, in one place.
 *
 * How many players and who they are used to be two separate decisions in two
 * separate parts of the lobby — a row of counts here, a Play button beside a
 * friend there — which made "a three-player game with Dad and Sam" something
 * you had to work out how to ask for.
 */
export function CreateGame({
  onStart,
  onCancel,
  starting,
  error,
  withFriend,
}: CreateGameProps) {
  const friends = useQuery(api.friends.listFriends);
  const [count, setCount] = useState(2);
  const [picked, setPicked] = useState<Id<"users">[]>(
    withFriend === undefined ? [] : [withFriend],
  );

  // You hold one seat, so the rest are what is left to fill.
  const seats = count - 1;
  const full = picked.length >= seats;
  const available = friends?.friends ?? [];

  const toggle = (userId: Id<"users">) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : full
          ? current
          : [...current, userId],
    );

  /** Shrinking the game past the people already picked drops the extras. */
  const choose = (next: number) => {
    setCount(next);
    setPicked((current) => current.slice(0, next - 1));
  };

  return (
    <Modal onDismiss={starting ? undefined : onCancel}>
      <div className={styles.body}>
        <h2 className={styles.title}>New game</h2>

        <div className={styles.field} role="group" aria-labelledby="playerCount">
          <span className={styles.label} id="playerCount">
            Players
          </span>
          <div className={styles.counts}>
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={[styles.count, n === count ? styles.countOn : ""].join(" ")}
                aria-pressed={n === count}
                aria-label={n === 1 ? "Solo game" : `${n} players`}
                onClick={() => choose(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {count === 1 ? (
          <p className={styles.hint}>Just you, against the board. Starts straight away.</p>
        ) : (
          <div>
            <h3 className={styles.heading}>
              Who’s playing{" "}
              <span className={styles.counter}>
                {picked.length} of {seats}
              </span>
            </h3>

            {friends === undefined && <p className={styles.hint}>Loading…</p>}
            {friends !== undefined && available.length === 0 && (
              <p className={styles.hint}>
                No friends to pick yet — start the game and send the invite link.
              </p>
            )}

            {available.map((f) => (
              <label key={f.friendshipId} className={styles.row}>
                <input
                  type="checkbox"
                  checked={picked.includes(f.userId)}
                  disabled={full && !picked.includes(f.userId)}
                  onChange={() => toggle(f.userId)}
                />
                <span className={styles.name}>{f.name}</span>
              </label>
            ))}

            {picked.length < seats && (
              <p className={styles.hint}>
                {seats - picked.length === 1 ? "The other seat" : "The other seats"} can be
                filled with an invite link once the game exists.
              </p>
            )}
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
            onClick={() => onStart(count, picked)}
            disabled={starting}
          >
            {starting ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

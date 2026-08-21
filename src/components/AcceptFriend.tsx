import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { userMessage } from "../lib/errors";
import styles from "./AcceptFriend.module.css";

interface AcceptFriendProps {
  token: string;
  onDone: () => void;
}

/**
 * Landing page for someone else's invite link.
 *
 * Runs on arrival rather than behind a button: following the link is the
 * decision, and asking again on the far side of a Google sign-in reads as
 * though something went wrong.
 */
export function AcceptFriend({ token, onDone }: AcceptFriendProps) {
  const accept = useMutation(api.friends.acceptFriendLink);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Strict mode mounts twice; the mutation is idempotent, but a second call
  // would race the first and could show an error over a success.
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    accept({ token })
      .then((owner) => setName(owner.name))
      .catch((err: unknown) => setError(userMessage(err)));
  }, [accept, token]);

  return (
    <div className={styles.card}>
      {error !== null ? (
        <>
          <h2 className={styles.title}>That link did not work</h2>
          <p className={styles.detail}>{error}</p>
        </>
      ) : name === null ? (
        <p className={styles.detail}>Adding you…</p>
      ) : (
        <>
          <h2 className={styles.title}>You and {name} are friends</h2>
          <p className={styles.detail}>
            They are in your friends list now — start a game from the menu.
          </p>
        </>
      )}
      <button type="button" className={styles.button} onClick={onDone}>
        Go to the lobby
      </button>
    </div>
  );
}

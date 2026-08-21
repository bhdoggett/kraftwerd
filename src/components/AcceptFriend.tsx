import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { userMessage } from "../lib/errors";
import styles from "./AcceptFriend.module.css";

type Result =
  | { ok: true; name: string }
  | { ok: false; reason: "expired" | "unknown" | "own" };

/** What to say for a link that did not work out. */
const TURNED_AWAY: Record<"expired" | "unknown" | "own", { title: string; detail: string }> = {
  expired: {
    title: "That invite link has expired",
    detail:
      "Links only last a few days. You are signed in, though — start a game, then send your own invite link back so they can add you.",
  },
  unknown: {
    title: "That link does not lead anywhere",
    detail:
      "It may have been mistyped, or replaced by a newer one. Ask whoever sent it for a fresh link.",
  },
  own: {
    title: "That is your own invite link",
    detail: "Send it to someone else, and they will land here and be added to your friends.",
  },
};

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
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Strict mode mounts twice; the mutation is idempotent, but a second call
  // would race the first and could show an error over a success.
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    accept({ token })
      .then(setResult)
      .catch((err: unknown) => setError(userMessage(err)));
  }, [accept, token]);

  return (
    <div className={styles.card}>
      {error !== null ? (
        <>
          <h2 className={styles.title}>That link did not work</h2>
          <p className={styles.detail}>{error}</p>
        </>
      ) : result === null ? (
        <p className={styles.detail}>Adding you…</p>
      ) : result.ok ? (
        <>
          <h2 className={styles.title}>You and {result.name} are friends</h2>
          <p className={styles.detail}>
            They are in your friends list now — start a game from the menu.
          </p>
        </>
      ) : (
        <>
          <h2 className={styles.title}>{TURNED_AWAY[result.reason].title}</h2>
          <p className={styles.detail}>{TURNED_AWAY[result.reason].detail}</p>
        </>
      )}
      <button type="button" className={styles.button} onClick={onDone}>
        Go to the lobby
      </button>
    </div>
  );
}

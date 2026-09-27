import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../Modal/Modal";
import styles from "./FriendRequests.module.css";

/** How long "Later" keeps the reminder away. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "kraftwerd:friend-requests-snoozed-until";

/*
 * The snooze is a per-device convenience, so it lives in this browser only
 * and every read and write is allowed to fail: a private window, blocked
 * storage or a thumbnail render just means the reminder can show again.
 */
function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function snooze(now: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_MS));
  } catch {
    // Nowhere to remember it; the reminder comes back next load.
  }
}

interface Request {
  friendshipId: Id<"friendships">;
  name: string;
}

interface FriendRequestsDialogProps {
  requests: readonly Request[];
  onAnswer: (friendshipId: Id<"friendships">, accept: boolean) => void;
  onLater: () => void;
}

export function FriendRequestsDialog({ requests, onAnswer, onLater }: FriendRequestsDialogProps) {
  return (
    <Modal onDismiss={onLater}>
      <div className={styles.body}>
        <h2 className={styles.title}>
          {requests.length === 1
            ? "Someone wants to be friends"
            : `${requests.length} people want to be friends`}
        </h2>
        <ul className={styles.list}>
          {requests.map((r) => (
            <li key={r.friendshipId} className={styles.row}>
              <span className={styles.name}>{r.name}</span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => onAnswer(r.friendshipId, false)}
              >
                Decline
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => onAnswer(r.friendshipId, true)}
              >
                Accept
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={styles.later} onClick={onLater}>
          Later
        </button>
      </div>
    </Modal>
  );
}

/**
 * A reminder of friend requests you have not answered, now and then.
 *
 * Requests only showed in the Friends panel, which is easy never to open.
 * This brings them up when the app loads, answerable on the spot; "Later"
 * puts it away for a day on this device. It keeps quiet while a game result
 * is waiting to be shown, so two dialogs never stack.
 */
export function FriendRequestsNotice() {
  const data = useQuery(api.friends.listFriends);
  const results = useQuery(api.games.pendingResults);
  const respond = useMutation(api.friends.respondToRequest);
  const [hiddenUntil, setHiddenUntil] = useState(snoozedUntil);

  const incoming = data?.incoming ?? [];
  if (incoming.length === 0) return null;
  if (results === undefined || results.length > 0) return null;
  if (Date.now() < hiddenUntil) return null;

  return (
    <FriendRequestsDialog
      requests={incoming}
      onAnswer={(friendshipId, accept) => void respond({ friendshipId, accept })}
      onLater={() => {
        const now = Date.now();
        snooze(now);
        setHiddenUntil(now + SNOOZE_MS);
      }}
    />
  );
}

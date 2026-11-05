import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../Modal/Modal";
import { friendRequestsShowing, snooze, snoozedUntil } from "./snooze";
import styles from "./FriendRequests.module.css";

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
  // Read once, on load: the clock is not something to consult while rendering.
  const [snoozed, setSnoozed] = useState(() => Date.now() < snoozedUntil());

  const incoming = data?.incoming ?? [];
  if (results === undefined) return null;
  if (!friendRequestsShowing(incoming.length, results.length, snoozed)) return null;

  return (
    <FriendRequestsDialog
      requests={incoming}
      onAnswer={(friendshipId, accept) => void respond({ friendshipId, accept })}
      onLater={() => {
        snooze(Date.now());
        setSnoozed(true);
      }}
    />
  );
}

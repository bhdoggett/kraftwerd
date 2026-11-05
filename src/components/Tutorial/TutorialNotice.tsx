import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { RULES_VERSION } from "../../../shared/config";
import { promisedGamePending } from "../../lib/useStartGame";
import { navigate } from "../../router";
import { tutorialStartedHere } from "../../tutorial/seen";
import { friendRequestsShowing, friendRequestsSnoozed } from "../FriendRequests/snooze";
import { Modal } from "../Modal/Modal";
import styles from "./TutorialNotice.module.css";

interface TutorialDialogProps {
  onTake: () => void;
  onLater: () => void;
}

/** The one-time offer: take the tutorial, or get on with it. */
export function TutorialDialog({ onTake, onLater }: TutorialDialogProps) {
  return (
    <Modal onDismiss={onLater}>
      <div className={styles.body}>
        <h2 className={styles.title}>New here?</h2>
        <p className={styles.lede}>
          A short walk through the game, one move at a time. It takes a couple of minutes.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onLater}>
            Not now
          </button>
          <button type="button" className={styles.primary} onClick={onTake}>
            Take the tutorial
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface Surroundings {
  /** Some modal is on screen. */
  dialogOpen: boolean;
  /** "Later" on the friend reminder is in force. */
  snoozed: boolean;
}

/**
 * What is on the page, watched as it changes. Undefined until the first look
 * has been taken, so nothing is decided on a guess.
 */
function useSurroundings(watching: boolean): Surroundings | undefined {
  const [seen, setSeen] = useState<Surroundings>();
  useEffect(() => {
    if (!watching) return;
    const look = () => {
      const dialogOpen = document.querySelector('[role="dialog"]') !== null;
      const snoozed = friendRequestsSnoozed();
      // Most DOM changes change neither: keep the same object then.
      setSeen((was) => (was?.dialogOpen === dialogOpen && was.snoozed === snoozed ? was : { dialogOpen, snoozed }));
    };
    look();
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [watching]);
  return watching ? seen : undefined;
}

/**
 * Offers the tutorial once, to an account that has not seen it.
 *
 * It waits its turn: not until the game results and friend requests have
 * loaded and, if either would show a dialog, not over it; never over the
 * display name prompt or the rule changes; not while a guest's dealt game is
 * still on its way; and not over any other open modal (a backstop, checked
 * from the page itself). Once it is up it stays up, so a friend request that
 * arrives afterwards can still stack on it. Either button records it on the
 * account, and it closes at once rather than waiting for the server.
 */
export function TutorialNotice() {
  const viewer = useQuery(api.users.viewer);
  const results = useQuery(api.games.pendingResults);
  const friends = useQuery(api.friends.listFriends);
  const markSeen = useMutation(api.users.markTutorialSeen);
  const [done, setDone] = useState(false);
  const [shown, setShown] = useState(false);
  // Read once, like the friend reminder's snooze: it does not change mid-load.
  const [startedHere] = useState(() => tutorialStartedHere());

  const eligible =
    viewer !== undefined &&
    viewer !== null &&
    !viewer.tutorialSeen &&
    !viewer.needsDisplayName &&
    viewer.rulesSeen >= RULES_VERSION &&
    !done;
  const silent = eligible && startedHere;
  const loaded = results !== undefined && friends !== undefined;
  const surroundings = useSurroundings(eligible && !silent && loaded && !shown);

  useEffect(() => {
    // Once the server agrees, the viewer reads as having seen it and this stops.
    if (silent) void markSeen();
  }, [silent, markSeen]);

  const clear =
    eligible &&
    !silent &&
    loaded &&
    results.length === 0 &&
    !friendRequestsShowing(friends.incoming.length, results.length, surroundings?.snoozed ?? true) &&
    !promisedGamePending() &&
    surroundings !== undefined &&
    !surroundings.dialogOpen;
  const show = shown || clear;
  // Latched during render: once up, the dialog the observer sees is our own.
  if (show && !shown) setShown(true);

  if (!show || !eligible) return null;

  const finish = () => {
    setDone(true);
    void markSeen();
  };
  return (
    <TutorialDialog
      onLater={finish}
      onTake={() => {
        finish();
        navigate({ name: "tutorial" });
      }}
    />
  );
}

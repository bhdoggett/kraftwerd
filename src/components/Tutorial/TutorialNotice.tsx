import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { RULES_VERSION } from "../../../shared/config";
import { navigate } from "../../router";
import { tutorialStartedHere } from "../../tutorial/seen";
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

/** Whether some modal other than ours is on screen, watched as the page changes. */
function useModalOpen(watching: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!watching) return;
    const check = () => setOpen(document.querySelector('[role="dialog"]') !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [watching]);
  return open;
}

/**
 * Offers the tutorial once, to an account that has not seen it.
 *
 * It waits its turn: never over the display name prompt, the rule changes, or
 * any other open modal. Once it has shown, it is latched, so the modal it sees
 * is no longer somebody else's. Either button records it on the account, and
 * it closes at once rather than waiting for the server to agree.
 */
export function TutorialNotice() {
  const viewer = useQuery(api.users.viewer);
  const markSeen = useMutation(api.users.markTutorialSeen);
  const [done, setDone] = useState(false);
  const [shown, setShown] = useState(false);

  const eligible =
    viewer !== undefined &&
    viewer !== null &&
    !viewer.tutorialSeen &&
    !viewer.needsDisplayName &&
    viewer.rulesSeen >= RULES_VERSION &&
    !done;
  const startedHere = eligible && tutorialStartedHere();
  const blocked = useModalOpen(eligible && !startedHere && !shown);

  useEffect(() => {
    // Once the server agrees, the viewer reads as having seen it and this stops.
    if (startedHere) void markSeen();
  }, [startedHere, markSeen]);

  const show = eligible && !startedHere && (shown || !blocked);
  // Latched during render: once up, the dialog the observer sees is our own.
  if (show && !shown) setShown(true);

  if (!show) return null;

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

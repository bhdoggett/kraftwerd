import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { RULES_VERSION } from "../../../shared/config";
import { Modal } from "../Modal/Modal";
import { changesSince, type RuleChange } from "./changes";
import styles from "./RuleChanges.module.css";

interface RuleChangesDialogProps {
  changes: readonly RuleChange[];
  onClose: () => void;
}

/** The list of what changed, newest first. */
export function RuleChangesDialog({ changes, onClose }: RuleChangesDialogProps) {
  const newestFirst = [...changes].sort((a, b) => b.version - a.version);

  return (
    <Modal onDismiss={onClose}>
      <div className={styles.body}>
        <h2 className={styles.title}>The rules have changed</h2>
        {newestFirst.map((entry) => (
          <ul key={entry.version} className={styles.list}>
            {entry.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        ))}
        <button type="button" className={styles.button} onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}

/**
 * Tells a returning player what changed since they last played, once.
 *
 * Dismissing it records the current version on their account, so it does not
 * come back on another device. It closes at once rather than waiting for the
 * server to agree.
 */
export function RuleChangesNotice() {
  const viewer = useQuery(api.users.viewer);
  const acknowledge = useMutation(api.users.acknowledgeRules);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !viewer || viewer.rulesSeen >= RULES_VERSION) return null;
  const changes = changesSince(viewer.rulesSeen);
  if (changes.length === 0) return null;

  return (
    <RuleChangesDialog
      changes={changes}
      onClose={() => {
        setDismissed(true);
        void acknowledge();
      }}
    />
  );
}

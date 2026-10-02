import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "../../lib/auth-client";
import { userMessage } from "../../lib/errors";
import { navigate } from "../../router";
import { Modal } from "../Modal/Modal";
import styles from "./Account.module.css";

const CONFIRM_WORD = "delete";

/**
 * The way out, behind a typed word: it cannot be undone, and a stray tap on a
 * phone should not be enough.
 */
export function DeleteAccount() {
  const deleteAccount = useMutation(api.users.deleteAccount);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setTyped("");
    setError(null);
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Delete account</h3>
      <p className={styles.hint}>
        Removes your name, email and friends. Games you are playing with other
        people are resigned; finished ones stay in their history under
        "Deleted player".
      </p>
      <button type="button" className={styles.danger} onClick={() => setOpen(true)}>
        Delete my account…
      </button>

      {open && (
        <Modal onDismiss={close}>
          <form
            className={styles.prompt}
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim().toLowerCase() !== CONFIRM_WORD) return;
              setDeleting(true);
              setError(null);
              deleteAccount()
                // The sessions are already gone on the server; this clears
                // the browser's copy. Failing that changes nothing that matters.
                .then(() => authClient.signOut().catch(() => undefined))
                .then(() => navigate({ name: "lobby" }))
                .catch((err: unknown) => {
                  setError(userMessage(err));
                  setDeleting(false);
                });
            }}
          >
            <h2 className={styles.title}>Delete your account?</h2>
            <ul className={styles.list}>
              <li>Your display name, Google name and email are erased.</li>
              <li>Your friends lose you from their lists.</li>
              <li>Games in progress with other people count as resigned.</li>
              <li>Games against the computer are deleted.</li>
              <li>This cannot be undone.</li>
            </ul>
            <label className={styles.label} htmlFor="confirm-delete">
              Type “{CONFIRM_WORD}” to confirm
            </label>
            <input
              id="confirm-delete"
              className={styles.input}
              value={typed}
              autoComplete="off"
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
            />
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondary}
                disabled={deleting}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.danger}
                disabled={deleting || typed.trim().toLowerCase() !== CONFIRM_WORD}
              >
                {deleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

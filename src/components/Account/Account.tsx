import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import styles from "./Account.module.css";
import { DeleteAccount } from "./DeleteAccount";
import { NameForm } from "./NameForm";

/** What other people see of this account, and what only its owner does. */
export function Account({ onBack }: { onBack: () => void }) {
  const viewer = useQuery(api.users.viewer);
  if (viewer === undefined) return <p className={styles.page}>Loading…</p>;
  if (viewer === null) return null;

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Account</h2>

      <section className={styles.section}>
        {/* Keyed so the field starts over from the saved name once it lands. */}
        <NameForm
          key={viewer.displayName ?? ""}
          current={viewer.displayName}
          submitLabel="Save"
        />
      </section>

      {!viewer.isGuest && (viewer.email || viewer.name) && (
        <section className={styles.section}>
          <h3 className={styles.heading}>Signed in with Google</h3>
          {viewer.name && <p className={styles.detail}>{viewer.name}</p>}
          {viewer.email && <p className={styles.detail}>{viewer.email}</p>}
          <p className={styles.hint}>
            Only you see these. Friends can still add you by your email address
            if they already know it.
          </p>
        </section>
      )}

      <DeleteAccount />

      <button type="button" className={styles.secondary} onClick={onBack}>
        Back to the lobby
      </button>
    </div>
  );
}

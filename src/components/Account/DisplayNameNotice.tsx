import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Modal } from "../Modal/Modal";
import styles from "./Account.module.css";
import { NameForm } from "./NameForm";

/**
 * Asks for a display name before anything else, and will not be waved away.
 *
 * Until a player chooses one they are "Player" to everybody, rather than the
 * name Google gave us: a friend's friend can sit at the same private table,
 * and they have no business knowing who you are.
 */
export function DisplayNameNotice() {
  const viewer = useQuery(api.users.viewer);
  if (!viewer?.needsDisplayName) return null;

  return (
    <Modal>
      <div className={styles.prompt}>
        <h2 className={styles.title}>Pick a display name</h2>
        <p className={styles.lede}>
          Other players see this instead of the name on your Google account.
          You can change it later from the menu.
        </p>
        <NameForm current={null} submitLabel="Save" />
      </div>
    </Modal>
  );
}

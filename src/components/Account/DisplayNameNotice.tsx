import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Modal } from "../Modal/Modal";
import styles from "./Account.module.css";
import { NameForm } from "./NameForm";

/**
 * Asks for a display name before anything else, and will not be waved away.
 *
 * It starts from their Google first name, but nothing is shown to anybody
 * until they keep it or change it. Until then they are "Player": a friend's
 * friend can sit at the same private table, and should not learn who you are
 * without you agreeing to it.
 */
export function DisplayNameNotice() {
  const viewer = useQuery(api.users.viewer);
  if (!viewer?.needsDisplayName) return null;

  const suggested = viewer.suggestedDisplayName;

  return (
    <Modal>
      <div className={styles.prompt}>
        <h2 className={styles.title}>
          {suggested ? "How other players see you" : "Pick a display name"}
        </h2>
        <p className={styles.lede}>
          {suggested ? (
            <>
              Other players will see you as <strong>{suggested}</strong>. Keep
              it, or change it to anything you like.
            </>
          ) : (
            "Other players see this instead of the name on your Google account."
          )}{" "}
          You can change it later under Account in the menu.
        </p>
        {/* Keyed so the field picks up the suggestion if it arrives late. */}
        <NameForm
          key={suggested ?? ""}
          current={null}
          initial={suggested}
          submitLabel="Save"
          keepLabel="Keep"
        />
      </div>
    </Modal>
  );
}

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import styles from "./DevTools.module.css";

/**
 * Only rendered when the deployment sets DEV_TOOLS=1, which production does
 * not. Lets one person exercise multiplayer without a second account.
 */
export function DevTools({ gameId }: { gameId?: Id<"games"> }) {
  const enabled = useQuery(api.dev.enabled);
  const seedFriends = useMutation(api.dev.seedFriends);
  const acceptInvites = useMutation(api.dev.acceptInvites);
  const fillSeats = useMutation(api.dev.fillSeats);
  const passForStandIn = useMutation(api.dev.passForStandIn);

  if (enabled !== true) return null;

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Dev</span>
      <button type="button" onClick={() => void seedFriends({})}>
        Add test friends
      </button>
      {gameId && (
        <>
          <button type="button" onClick={() => void fillSeats({ gameId })}>
            Fill seats
          </button>
          <button type="button" onClick={() => void acceptInvites({ gameId })}>
            Accept invites
          </button>
          <button type="button" onClick={() => void passForStandIn({ gameId })}>
            Pass their turn
          </button>
        </>
      )}
    </div>
  );
}

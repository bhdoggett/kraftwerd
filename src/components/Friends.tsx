import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { userMessage } from "../lib/errors";
import styles from "./Friends.module.css";
import { StartGame, type Player } from "./StartGame";

export function Friends({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const data = useQuery(api.friends.listFriends);
  const requestFriend = useMutation(api.friends.requestFriend);
  const respond = useMutation(api.friends.respondToRequest);
  const removeFriend = useMutation(api.friends.removeFriend);
  const cancelInvite = useMutation(api.friends.cancelInvite);
  const createWithFriends = useMutation(api.games.createGameWithFriends);

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The friend whose Play button was pressed, while the game is being set up. */
  const [opponent, setOpponent] = useState<Player | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function start(friendIds: Id<"users">[]) {
    setStartError(null);
    setStarting(true);
    try {
      const gameId = await createWithFriends({ friendIds });
      setOpponent(null);
      onOpen(gameId);
    } catch (err) {
      setStartError(userMessage(err));
    } finally {
      setStarting(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await requestFriend({ email });
      setEmail("");
    } catch (err) {
      setError(userMessage(err));
    }
  }


  return (
    <div className={styles.panel}>
      {opponent && (
        <StartGame
          friend={opponent}
          others={(data?.friends ?? [])
            .filter((f) => f.userId !== opponent.userId)
            .map((f) => ({ userId: f.userId, name: f.name }))}
          onStart={(friendIds) => void start(friendIds)}
          onCancel={() => {
            setOpponent(null);
            setStartError(null);
          }}
          starting={starting}
          error={startError}
        />
      )}

      <form className={styles.add} onSubmit={(e) => void add(e)}>
        <input
          className={styles.input}
          type="email"
          value={email}
          placeholder="Add by email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className={styles.secondary} disabled={email.trim() === ""}>
          Add
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {data === undefined && <p className={styles.empty}>Loading…</p>}

      {data && data.incoming.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.heading}>Wants to be friends</h3>
          {data.incoming.map((f) => (
            <div key={f.friendshipId} className={styles.row}>
              <span className={styles.name}>
                {f.name}
                <br />
                <span className={styles.email}>{f.email}</span>
              </span>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  void respond({ friendshipId: f.friendshipId, accept: true })
                }
              >
                Accept
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  void respond({ friendshipId: f.friendshipId, accept: false })
                }
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className={styles.section}>
          {data.friends.length === 0 && (
            <p className={styles.empty}>
              No friends yet. Add anyone by email — if they have never played,
              the request waits for them and turns up the first time they sign
              in.
            </p>
          )}

          {data.friends.map((f) => (
            <div key={f.friendshipId} className={styles.row}>
              <span className={styles.name}>
                {f.name}
                <br />
                <span className={styles.email}>{f.email}</span>
              </span>
              <button
                type="button"
                className={styles.button}
                onClick={() => setOpponent({ userId: f.userId, name: f.name })}
              >
                Play
              </button>
              <button
                type="button"
                className={styles.danger}
                onClick={() => void removeFriend({ friendshipId: f.friendshipId })}
              >
                Remove
              </button>
            </div>
          ))}

        </div>
      )}

      {data && data.invited.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.heading}>Invited, not signed up yet</h3>
          {data.invited.map((invite) => (
            <div key={invite.inviteId} className={styles.row}>
              <span className={styles.name}>
                {invite.email}
                <br />
                <span className={styles.email}>
                  becomes a friend request when they sign in
                </span>
              </span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void cancelInvite({ inviteId: invite.inviteId })}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {data && data.outgoing.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.heading}>Waiting on them</h3>
          {data.outgoing.map((f) => (
            <div key={f.friendshipId} className={styles.row}>
              <span className={styles.name}>
                {f.name}
                <br />
                <span className={styles.email}>{f.email}</span>
              </span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void removeFriend({ friendshipId: f.friendshipId })}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

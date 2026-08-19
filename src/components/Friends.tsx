import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import styles from "./Friends.module.css";

export function Friends({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const data = useQuery(api.friends.listFriends);
  const requestFriend = useMutation(api.friends.requestFriend);
  const respond = useMutation(api.friends.respondToRequest);
  const removeFriend = useMutation(api.friends.removeFriend);
  const createWithFriends = useMutation(api.games.createGameWithFriends);

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Id<"users">[]>([]);

  const toggle = (userId: Id<"users">) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : // 4 players max, so 3 opponents.
          current.length >= 3
          ? current
          : [...current, userId],
    );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await requestFriend({ email });
      setEmail("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.replace(/^.*Error:\s*/s, "").split("\n")[0]!);
    }
  }

  async function startGame() {
    setError(null);
    try {
      onOpen(await createWithFriends({ friendIds: picked }));
      setPicked([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.replace(/^.*Error:\s*/s, "").split("\n")[0]!);
    }
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Friends</h2>

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
              No friends yet. Add someone by the email they signed in with — they
              have to accept before you can start a game together.
            </p>
          )}

          {data.friends.map((f) => (
            <div key={f.friendshipId} className={styles.row}>
              <input
                type="checkbox"
                className={styles.pick}
                checked={picked.includes(f.userId)}
                onChange={() => toggle(f.userId)}
                aria-label={`Play against ${f.name}`}
              />
              <span className={styles.name}>
                {f.name}
                <br />
                <span className={styles.email}>{f.email}</span>
              </span>
              <button
                type="button"
                className={styles.danger}
                onClick={() => void removeFriend({ friendshipId: f.friendshipId })}
              >
                Remove
              </button>
            </div>
          ))}

          {data.friends.length > 0 && (
            <div className={styles.section}>
              <button
                type="button"
                className={styles.button}
                disabled={picked.length === 0}
                onClick={() => void startGame()}
              >
                Start game with {picked.length || "…"}{" "}
                {picked.length === 1 ? "friend" : "friends"}
              </button>
            </div>
          )}
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
    </section>
  );
}

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FRIEND_LINK_DAYS } from "../../shared/config";
import { userMessage } from "../lib/errors";
import styles from "./Friends.module.css";
import { StartGame, type Player } from "./StartGame";

/**
 * Desktop Firefox has no share sheet, and Chrome only offers one on some
 * platforms, so the copy button is not a fallback anyone should have to hunt
 * for — it stays on show either way.
 */
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

export function Friends({ onOpen }: { onOpen: (gameId: Id<"games">) => void }) {
  const data = useQuery(api.friends.listFriends);
  const requestFriend = useMutation(api.friends.requestFriend);
  const respond = useMutation(api.friends.respondToRequest);
  const removeFriend = useMutation(api.friends.removeFriend);
  const cancelInvite = useMutation(api.friends.cancelInvite);
  const createWithFriends = useMutation(api.games.createGameWithFriends);
  const link = useQuery(api.friends.myFriendLink);
  const createLink = useMutation(api.friends.createFriendLink);

  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);
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

  /** The link, made on first use rather than for everyone who opens this. */
  async function linkUrl() {
    const token = link?.token ?? (await createLink({}));
    return `${window.location.origin}/friend/${token}`;
  }

  async function copyLink() {
    setError(null);
    try {
      await navigator.clipboard.writeText(await linkUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(userMessage(err));
    }
  }

  /**
   * Hand the link to the phone's share sheet, so it arrives in a message with
   * a sentence rather than as a bare URL somebody has to explain.
   */
  async function shareLink() {
    setError(null);
    try {
      await navigator.share({
        title: "kraftwerd",
        text: "Play kraftwerd with me",
        url: await linkUrl(),
      });
    } catch (err) {
      // Backing out of the share sheet is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(userMessage(err));
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

      {/*
        Anyone holding this becomes a friend on following it, which is the
        point — it goes in a message to someone you know. It runs out on its
        own, so a link forwarded on does not work forever.
      */}
      <div className={styles.section}>
        <h3 className={styles.heading}>Invite by link</h3>
        <p className={styles.hint}>
          Send this to anyone. Following it adds them to your friends list,
          whether or not they have played before. A link works for{" "}
          {FRIEND_LINK_DAYS} days, then sending a new one starts the clock
          again.
        </p>
        <div className={styles.add}>
          {canShare && (
            <button type="button" className={styles.button} onClick={() => void shareLink()}>
              Share
            </button>
          )}
          <button
            type="button"
            className={canShare ? styles.secondary : styles.button}
            onClick={() => void copyLink()}
          >
            {copied ? "Copied" : canShare ? "Copy" : "Copy invite link"}
          </button>
        </div>
      </div>

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

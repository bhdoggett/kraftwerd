import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { userMessage } from "../lib/errors";
import styles from "./NewGame.module.css";

interface NewGameProps {
  gameId: Id<"games">;
  name: string;
  playerCount: number;
  onOpen: (gameId: Id<"games">) => void;
  onClose: () => void;
}

/**
 * Shown straight after a game is created, while it is still filling.
 *
 * Both ways of filling a seat live here — send the link, or invite a friend —
 * because at the moment of creating a game that is the only decision left, and
 * splitting it across the lobby and the board made the link hard to find.
 */
export function NewGame({ gameId, name, playerCount, onOpen, onClose }: NewGameProps) {
  const friends = useQuery(api.friends.listFriends);
  const invite = useMutation(api.games.inviteToGame);

  const [picked, setPicked] = useState<Id<"users">[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<Id<"users">[]>([]);

  const url = `${window.location.origin}/game/${gameId}`;
  const seatsToFill = playerCount - 1 - invited.length;

  const toggle = (userId: Id<"users">) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length >= seatsToFill
          ? current
          : [...current, userId],
    );

  async function sendInvites() {
    setError(null);
    try {
      await invite({ gameId, friendIds: picked });
      setInvited((current) => [...current, ...picked]);
      setPicked([]);
    } catch (err) {
      setError(userMessage(err));
    }
  }

  const available = (friends?.friends ?? []).filter((f) => !invited.includes(f.userId));

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div>
          <h2 className={styles.title}>{name}</h2>
          <p className={styles.subtitle}>
            {seatsToFill > 0
              ? `${seatsToFill} more ${seatsToFill === 1 ? "player" : "players"} needed. The game starts once every seat is taken.`
              : "Everyone is invited. The game starts once they accept."}
          </p>
        </div>

        <div>
          <h3 className={styles.heading}>Invite by link</h3>
          <div className={styles.link}>
            <span className={styles.url}>{url}</span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <h3 className={styles.heading}>Invite a friend</h3>
          {friends === undefined && <p className={styles.empty}>Loading…</p>}
          {friends && available.length === 0 && (
            <p className={styles.empty}>
              No friends to invite yet — send the link instead. Anyone who joins
              that way is added to your friends.
            </p>
          )}
          {available.map((f) => (
            <div key={f.friendshipId} className={styles.row}>
              <input
                type="checkbox"
                checked={picked.includes(f.userId)}
                disabled={!picked.includes(f.userId) && picked.length >= seatsToFill}
                onChange={() => toggle(f.userId)}
                aria-label={`Invite ${f.name}`}
              />
              <span className={styles.name}>{f.name}</span>
            </div>
          ))}
          {picked.length > 0 && (
            <div className={styles.actions} style={{ marginTop: "var(--space-3)" }}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void sendInvites()}
              >
                Invite {picked.length}
              </button>
            </div>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Back to lobby
          </button>
          <button type="button" className={styles.button} onClick={() => onOpen(gameId)}>
            Open game
          </button>
        </div>
      </div>
    </div>
  );
}

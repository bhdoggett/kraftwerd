import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DIFFICULTIES, GAME, type Difficulty } from "../../shared/config";
import { botLabel, seatsFree, trimRoster } from "../lib/roster";
import { Modal } from "./Modal";
import styles from "./CreateGame.module.css";

interface CreateGameProps {
  onStart: (
    playerCount: number,
    friendIds: Id<"users">[],
    bots: Difficulty[],
  ) => void;
  onCancel: () => void;
  starting: boolean;
  error: string | null;
  /**
   * Someone already chosen — the friend whose Play button was pressed. They
   * start ticked, and the game starts at two players rather than one.
   */
  withFriend?: Id<"users">;
}

const COUNTS = Array.from({ length: GAME.maxPlayers }, (_, i) => i + 1);

/** What a bot added on the spur of the moment plays at until told otherwise. */
const DEFAULT_LEVEL: Difficulty = "medium";

/**
 * Everything about starting a game, in one place.
 *
 * How many players and who they are used to be two separate decisions in two
 * separate parts of the lobby — a row of counts here, a Play button beside a
 * friend there — which made "a three-player game with Dad and Sam" something
 * you had to work out how to ask for.
 */
export function CreateGame({
  onStart,
  onCancel,
  starting,
  error,
  withFriend,
}: CreateGameProps) {
  const friends = useQuery(api.friends.listFriends);
  const [count, setCount] = useState(2);
  const [picked, setPicked] = useState<Id<"users">[]>(
    withFriend === undefined ? [] : [withFriend],
  );
  const [bots, setBots] = useState<Difficulty[]>([]);

  // You hold one seat, so the rest are what is left to fill -- and friends and
  // machines are filling the same ones.
  const seats = count - 1;
  const free = seatsFree({ friends: picked, bots }, count);
  const full = free === 0;
  const available = friends?.friends ?? [];

  const toggle = (userId: Id<"users">) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : full
          ? current
          : [...current, userId],
    );

  /** Shrinking the game past the table drops the machines first. */
  const choose = (next: number) => {
    const trimmed = trimRoster({ friends: picked, bots }, next);
    setCount(next);
    setPicked([...trimmed.friends]);
    setBots([...trimmed.bots]);
  };

  const setLevel = (index: number, level: Difficulty) =>
    setBots((current) => current.map((b, i) => (i === index ? level : b)));

  return (
    <Modal onDismiss={starting ? undefined : onCancel}>
      <div className={styles.body}>
        <h2 className={styles.title}>New game</h2>

        <div className={styles.field} role="group" aria-labelledby="playerCount">
          <span className={styles.label} id="playerCount">
            Players
          </span>
          <div className={styles.counts}>
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={[styles.count, n === count ? styles.countOn : ""].join(" ")}
                aria-pressed={n === count}
                aria-label={n === 1 ? "Solo game" : `${n} players`}
                onClick={() => choose(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {count === 1 ? (
          <p className={styles.hint}>Just you, against the board. Starts straight away.</p>
        ) : (
          <div>
            <h3 className={styles.heading}>
              Who’s playing{" "}
              <span className={styles.counter}>
                {seats - free} of {seats}
              </span>
            </h3>

            {friends === undefined && <p className={styles.hint}>Loading…</p>}
            {friends !== undefined && available.length === 0 && (
              <p className={styles.hint}>
                No friends to pick yet — add a computer player, or start the game and
                send the invite link.
              </p>
            )}

            {available.map((f) => (
              <label key={f.friendshipId} className={styles.row}>
                <input
                  type="checkbox"
                  checked={picked.includes(f.userId)}
                  disabled={full && !picked.includes(f.userId)}
                  onChange={() => toggle(f.userId)}
                />
                <span className={styles.name}>{f.name}</span>
              </label>
            ))}

            {/*
              Each machine picks its own level. One hard opponent alongside an
              easy one is a normal thing to want at a family table, and asking
              once per bot is the only way to say it.
            */}
            {bots.map((level, i) => (
              <div key={i} className={styles.botRow}>
                <span className={styles.name}>
                  {botLabel(i)} <span className={styles.machine}>computer</span>
                </span>
                <div
                  className={styles.levels}
                  role="group"
                  aria-label={`How well ${botLabel(i)} plays`}
                >
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={[styles.level, d === level ? styles.levelOn : ""].join(
                        " ",
                      )}
                      aria-pressed={d === level}
                      onClick={() => setLevel(i, d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Take ${botLabel(i)} out of the game`}
                  onClick={() => setBots((current) => current.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}

            {!full && (
              <button
                type="button"
                className={styles.addBot}
                onClick={() => setBots((current) => [...current, DEFAULT_LEVEL])}
              >
                + Add computer player
              </button>
            )}

            {free > 0 && (
              <p className={styles.hint}>
                {free === 1 ? "The other seat" : "The other seats"} can be filled with an
                invite link once the game exists.
              </p>
            )}
          </div>
        )}

        {error !== null && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={onCancel}
            disabled={starting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => onStart(count, picked, bots)}
            disabled={starting}
          >
            {starting ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DIFFICULTIES, GAME, type Difficulty } from "../../../shared/config";
import { drawBotNames, seatsSpare } from "../../lib/roster";
import type { BotSeat } from "../../lib/useStartGame";
import { Modal } from "../Modal/Modal";
import styles from "./CreateGame.module.css";

interface CreateGameProps {
  onStart: (
    playerCount: number,
    friendIds: Id<"users">[],
    bots: BotSeat[],
  ) => void;
  onCancel: () => void;
  starting: boolean;
  error: string | null;
  /**
   * Someone already chosen — the friend whose Play button was pressed. The
   * screen opens on the people it was pressed from, with them ticked.
   */
  withFriend?: Id<"users">;
}

const COUNTS = Array.from({ length: GAME.maxPlayers }, (_, i) => i + 1);

/** What a machine plays at until told otherwise. */
const DEFAULT_LEVEL: Difficulty = "medium";

/** Which game is being set up: people, machines, or not yet said. */
type Path = "people" | "machines" | null;

/**
 * Everything about starting a game, in one place.
 *
 * The first question is who you are playing, because it is the one that
 * decides what the rest of the screen is for. A game of people is you and
 * whoever you asked; a game of machines is a number and how hard each one
 * plays. Trying to serve both at once meant a screen where the count, the
 * friends and the machines all argued over the same seats, and where a
 * three-player game with Dad and one hard robot was something you had to
 * work out how to ask for rather than something you could see.
 */
export function CreateGame({
  onStart,
  onCancel,
  starting,
  error,
  withFriend,
}: CreateGameProps) {
  const friends = useQuery(api.friends.listFriends);
  const [path, setPath] = useState<Path>(
    withFriend === undefined ? null : "people",
  );

  const [picked, setPicked] = useState<Id<"users">[]>(
    withFriend === undefined ? [] : [withFriend],
  );
  /** Seats deliberately left empty, for whoever the invite link reaches. */
  const [open, setOpen] = useState(0);

  const [count, setCount] = useState(2);
  const [bots, setBots] = useState<BotSeat[]>(() =>
    drawBotNames(1, Math.random).map((name) => ({
      name,
      level: DEFAULT_LEVEL,
    })),
  );

  const available = friends?.friends ?? [];
  const spare = seatsSpare(picked.length, open);
  const people = 1 + picked.length + open;

  const toggle = (userId: Id<"users">) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : spare === 0
          ? current
          : [...current, userId],
    );

  /**
   * A table of machines is filled the moment you say how big it is.
   *
   * Growing it keeps the machines already on screen under the names they were
   * given — being told you are playing Sam and then finding Sam renamed on
   * the way to a fourth seat is the sort of thing that makes a screen feel
   * like it is guessing.
   */
  const resize = (next: number) => {
    setCount(next);
    setBots((current) => {
      const wanted = next - 1;
      if (wanted <= current.length) return current.slice(0, wanted);
      const fresh = drawBotNames(
        wanted - current.length,
        Math.random,
        current.map((b) => b.name),
      );
      return [
        ...current,
        ...fresh.map((name) => ({ name, level: DEFAULT_LEVEL })),
      ];
    });
  };

  const setLevel = (index: number, level: Difficulty) =>
    setBots((current) =>
      current.map((b, i) => (i === index ? { ...b, level } : b)),
    );

  /* A game of people needs somebody in it, even if only a seat held open. */
  const ready = path === "machines" || picked.length + open > 0;

  return (
    <Modal onDismiss={starting ? undefined : onCancel}>
      <div className={styles.body}>
        <h2 className={styles.title}>New game</h2>

        {path === null && (
          <div className={styles.choices}>
            <button
              type="button"
              className={styles.choice}
              onClick={() => setPath("people")}
            >
              <strong>Humans</strong>
              <span className={styles.choiceHint}>
                Ask a friend, or leave a seat open and send the link.
              </span>
            </button>

            <button
              type="button"
              className={styles.choice}
              onClick={() => setPath("machines")}
            >
              <strong>Robots</strong>
              <span className={styles.choiceHint}>
                Say how many, and how well each one plays. Starts straight away.
              </span>
            </button>
          </div>
        )}

        {path !== null && (
          <button
            type="button"
            className={styles.back}
            onClick={() => setPath(null)}
          >
            ← Humans or robots
          </button>
        )}

        {path === "machines" && (
          <div>
            <div
              className={styles.field}
              role="group"
              aria-labelledby="playerCount"
            >
              <span className={styles.label} id="playerCount">
                Players
              </span>
              <div className={styles.counts}>
                {COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={[
                      styles.count,
                      n === count ? styles.countOn : "",
                    ].join(" ")}
                    aria-pressed={n === count}
                    aria-label={n === 1 ? "Solo game" : `${n} players`}
                    onClick={() => resize(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {count === 1 ? (
              <p className={styles.hint}>
                Just you, against the board. Starts straight away.
              </p>
            ) : (
              /*
                Each machine picks its own level. One hard opponent alongside
                an easy one is a normal thing to want at a family table, and
                asking once per machine is the only way to say it.

                No way to take one out: the count above is what decides how
                many there are, and on a table with nobody to invite a seat
                removed by hand would be a hole with nothing to fill it.
              */
              bots.map((bot, i) => (
                <div key={bot.name} className={styles.botRow}>
                  <span className={styles.name}>
                    {bot.name} <span className={styles.machine}>computer</span>
                  </span>
                  <div
                    className={styles.levels}
                    role="group"
                    aria-label={`How well ${bot.name} plays`}
                  >
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={[
                          styles.level,
                          d === bot.level ? styles.levelOn : "",
                        ].join(" ")}
                        aria-pressed={d === bot.level}
                        onClick={() => setLevel(i, d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {path === "people" && (
          <div>
            <h3 className={styles.heading}>
              Who’s playing{" "}
              <span className={styles.counter}>{people} at the table</span>
            </h3>

            {friends === undefined && <p className={styles.hint}>Loading…</p>}
            {friends !== undefined && available.length === 0 && (
              <p className={styles.hint}>
                No friends to pick yet — hold a seat open below and send the
                link once the game exists.
              </p>
            )}

            {available.map((f) => (
              <label key={f.friendshipId} className={styles.row}>
                <input
                  type="checkbox"
                  checked={picked.includes(f.userId)}
                  disabled={spare === 0 && !picked.includes(f.userId)}
                  onChange={() => toggle(f.userId)}
                />
                <span className={styles.name}>{f.name}</span>
              </label>
            ))}

            {/*
              A seat with nobody's name against it yet. Counted rather than
              ticked, because the question is how many people the link should
              reach, and a friend list has no row to stand for a stranger.
            */}
            <div className={styles.botRow}>
              <span className={styles.name}>
                Open{" "}
                <span className={styles.machine}>
                  {open === 1 ? "seat for the link" : "seats for the link"}
                </span>
              </span>
              <div
                className={styles.levels}
                role="group"
                aria-label="Seats left open"
              >
                <button
                  type="button"
                  className={styles.level}
                  aria-label="One fewer open seat"
                  disabled={open === 0}
                  onClick={() => setOpen((n) => n - 1)}
                >
                  −
                </button>
                <span className={styles.openCount} aria-live="polite">
                  {open}
                </span>
                <button
                  type="button"
                  className={styles.level}
                  aria-label="One more open seat"
                  disabled={spare === 0}
                  onClick={() => setOpen((n) => n + 1)}
                >
                  +
                </button>
              </div>
            </div>

            {!ready && (
              <p className={styles.hint}>
                Pick a friend, or hold a seat open — a game on your own is a
                game of robots.
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
            onClick={() =>
              path === "machines"
                ? onStart(count, [], bots)
                : onStart(people, picked, [])
            }
            disabled={starting || path === null || !ready}
          >
            {starting ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

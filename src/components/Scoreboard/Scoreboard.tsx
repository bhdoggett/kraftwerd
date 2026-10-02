import { BagContents } from "../BagContents/BagContents";
import styles from "./Scoreboard.module.css";

interface Standing {
  userId: string;
  seat: number;
  score: number;
  name: string;
  isYou: boolean;
  /**
   * Tiles in hand. The count, never the letters -- how many someone is
   * holding is public, the way a rack of tiles on a table is; what is on them
   * is not.
   *
   * Null when it cannot honestly be said: a review steps the board and the
   * scores back through the game, but a turn does not record what was in
   * anyone's hand at the time, so the only count available is today's.
   */
  tilesInHand: number | null;
}

/**
 * Where you stand with somebody at this table: friends already, one of you
 * has asked, or neither has. Absent for machines, for your own seat, and for
 * every seat at a game with strangers -- the server says nothing about those,
 * so nothing is offered.
 */
interface FriendState {
  userId: string;
  state: "friends" | "asked" | "asking" | "none";
}

interface ScoreboardProps {
  players: readonly Standing[];
  currentSeat: number;
  /**
   * Asking lives beside the name, and stays there: an invitation gathers
   * people who may never have met, and this is the only way two of them find
   * each other afterwards. Empty until the states are loaded, which is why
   * nothing here waits on them.
   */
  friendStates?: readonly FriendState[];
  onInvite?: (userId: string) => void;
  /** Tiles nobody has drawn yet: what is left of the game. */
  tilesLeft: number;
  /**
   * Every letter not on the board and not in your own hand -- the bag and
   * the other hands together. What BagContents actually draws, and not the
   * same thing as what is left in the bag: see `unseen` in `getGame`.
   */
  unseen: Record<string, number>;
  bagSize: number;
  status: "lobby" | "active" | "finished";
  /** Absent when there is nothing to quit — a finished game, or a spectator. */
  onQuit?: () => void;
}

export function Scoreboard({
  players,
  currentSeat,
  friendStates,
  onInvite,
  tilesLeft,
  unseen,
  bagSize,
  status,
  onQuit,
}: ScoreboardProps) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const onTurn = ordered.find((p) => p.seat === currentSeat) ?? null;
  // How far through the bag the game is, which is how far through the game it
  // is: it ends when the tiles run out and somebody empties their hand.
  const pct = Math.min(100, Math.round(((bagSize - tilesLeft) / bagSize) * 100));

  return (
    // Named for screen readers, since the "Scores" heading it used to carry
    // went: the cards say what they are to anyone who can see them.
    <aside className={styles.panel} aria-label="Scores">
      {/*
        Whose move it is, said outright, with Quit at the end of the same
        line. The row for that seat was in bold, which tells you once you have
        worked out that bold is what it means.
      */}
      {(status === "active" || onQuit) && (
        <div className={styles.header}>
          {status === "active" && (
            <p className={styles.turnLine}>
              {onTurn === null
                ? "Waiting"
                : onTurn.isYou
                  ? "Your turn"
                  : `${onTurn.name}'s turn`}
            </p>
          )}
          {onQuit && (
            <button type="button" className={styles.quit} onClick={onQuit}>
              Quit
            </button>
          )}
        </div>
      )}

      {/*
        Side by side, a card a player: the score large, the name under it.
        Stacked rows took a line of the panel a player and pushed what the
        play is worth down the page; across, all three fit in the height of
        one.
      */}
      <div className={styles.players}>
        {ordered.map((p) => {
          const friend = friendStates?.find((f) => f.userId === p.userId);
          const showTiles =
            (tilesLeft === 0 || status === "finished") &&
            status !== "lobby" &&
            p.tilesInHand !== null;

          return (
            <div key={p.userId} className={styles.player}>
              <span
                className={[
                  styles.dot,
                  p.seat === currentSeat && status === "active" ? styles.onTurn : "",
                ].join(" ")}
                style={{ background: `var(--seat-${p.seat % 4})` }}
              >
                {p.score}
              </span>
              <span
                className={[
                  styles.name,
                  p.seat === currentSeat && status !== "finished" ? styles.turn : "",
                ].join(" ")}
                title={p.name}
              >
                {p.name}
              </span>

              {(showTiles || (friend !== undefined && friend.state !== "friends")) && (
                <span className={styles.extras}>
                  {/*
                    Asked and asking both read as text rather than a control:
                    the first has nothing left to do, and the second is
                    answered in the friends list, where accept and decline
                    already live.
                  */}
                  {friend?.state === "asked" && (
                    <span
                      className={styles.invited}
                      aria-label={`Friend invite sent to ${p.name}`}
                    >
                      asked
                    </span>
                  )}
                  {friend?.state === "asking" && (
                    <span
                      className={styles.invited}
                      aria-label={`${p.name} sent you a friend invite`}
                    >
                      asks you
                    </span>
                  )}
                  {friend?.state === "none" && (
                    <button
                      type="button"
                      className={styles.invite}
                      aria-label={`Send friend invite to ${p.name}`}
                      onClick={() => onInvite?.(p.userId)}
                    >
                      +
                    </button>
                  )}
                  {/*
                    How many tiles they are holding, once the bag can no
                    longer top anyone up.

                    Not before: while there are tiles to draw, every hand
                    refills to a full rack after every play, so the number is
                    the same on every card and says nothing. Once the bag is
                    dry the hands start to differ, and what is left in them
                    decides the game -- whoever goes out takes what everyone
                    else is still holding.
                  */}
                  {showTiles && (
                    <span
                      className={styles.tiles}
                      aria-label={`${p.tilesInHand} ${p.tilesInHand === 1 ? "tile" : "tiles"} in hand`}
                    >
                      {p.tilesInHand}
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/*
        The bar alone says how far through the game is -- exact counts
        already live in BagContents' own line just below, so a plain
        "N tiles played" caption here would only repeat it. Kept only for
        the two states that are actual news: the game ending, and the bag
        running dry while hands still differ.
      */}
      <div className={styles.progress}>
        <div className={styles.bar}>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
        {(status === "finished" || tilesLeft === 0) && (
          <p className={styles.caption}>
            {status === "finished" ? "Game over" : "The bag is empty — play out your hand"}
          </p>
        )}
      </div>

      {status !== "finished" && <BagContents left={tilesLeft} unseen={unseen} />}
    </aside>
  );
}

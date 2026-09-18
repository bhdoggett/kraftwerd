import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Scoreboard } from "./Scoreboard";

afterEach(cleanup);

const players = [
  { userId: "u1", seat: 0, score: 40, name: "Ann", isYou: true, tilesInHand: 7 },
  { userId: "u2", seat: 1, score: 31, name: "Bob", isYou: false, tilesInHand: 3 },
];

function draw(status: "lobby" | "active" | "finished", tilesLeft = 0) {
  render(
    <Scoreboard
      players={players}
      currentSeat={0}
      tilesLeft={tilesLeft}
      bagRemaining={{}}
      bagSize={71}
      status={status}
    />,
  );
}

/**
 * Asking somebody to be friends lives beside their name, where they are named
 * -- not behind a panel that only exists once the game is over. An invitation
 * gathers people who may not know each other, and this is the only way two of
 * them can find each other afterwards.
 */
describe("asking somebody to be friends", () => {
  const states = [
    { userId: "u2", state: "none" as const },
  ];

  function drawWith(
    friendStates: { userId: string; state: "friends" | "asked" | "asking" | "none" }[],
    onInvite: (userId: string) => void = () => {},
  ) {
    render(
      <Scoreboard
        players={players}
        currentSeat={0}
        tilesLeft={0}
        bagRemaining={{}}
        bagSize={71}
        status="active"
        friendStates={friendStates}
        onInvite={onInvite}
      />,
    );
  }

  test("offers to ask somebody you are not friends with", async () => {
    const asked: string[] = [];
    drawWith(states, (userId: string) => asked.push(userId));

    const invite = screen.getByLabelText("Send friend invite to Bob");
    invite.click();

    expect(asked).toEqual(["u2"]);
  });

  test("asks nobody you are already friends with", () => {
    drawWith([{ userId: "u2", state: "friends" }]);

    expect(screen.queryByLabelText(/friend invite/)).toBeNull();
  });

  test("says so once you have asked, rather than offering again", () => {
    drawWith([{ userId: "u2", state: "asked" }]);

    expect(screen.queryByLabelText("Send friend invite to Bob")).toBeNull();
    expect(screen.getByLabelText("Friend invite sent to Bob")).toBeTruthy();
  });

  test("says when they are the one waiting on you", () => {
    drawWith([{ userId: "u2", state: "asking" }]);

    expect(screen.getByLabelText("Bob sent you a friend invite")).toBeTruthy();
  });

  test("offers nothing at a table it was given nothing about", () => {
    drawWith([]);

    expect(screen.queryByLabelText(/friend invite/)).toBeNull();
  });
});

describe("what everyone is holding", () => {
  test("says how many tiles each player has in hand once the bag is dry", () => {
    draw("active");

    expect(screen.getByLabelText("7 tiles in hand").textContent).toBe("7");
    expect(screen.getByLabelText("3 tiles in hand").textContent).toBe("3");
  });

  test("still says so once the game is over, when it decided the score", () => {
    draw("finished");

    expect(screen.getByLabelText("3 tiles in hand").textContent).toBe("3");
  });

  test("says nothing while the bag can still fill every hand", () => {
    // Every rack refills after every play, so the count would read seven on
    // every row and mean nothing.
    draw("active", 20);

    expect(screen.queryByLabelText(/tiles in hand/)).toBeNull();
  });

  test("says nothing about hands before the game has dealt any", () => {
    draw("lobby");

    expect(screen.queryByLabelText(/tiles in hand/)).toBeNull();
  });

  test("one tile is a tile, not tiles", () => {
    render(
      <Scoreboard
        players={[{ ...players[1], tilesInHand: 1 }]}
        currentSeat={0}
          tilesLeft={0}
        bagRemaining={{}}
        bagSize={71}
        status="active"
      />,
    );

    expect(screen.getByLabelText("1 tile in hand").textContent).toBe("1");
  });

  test("says nothing for a hand it cannot honestly count", () => {
    render(
      <Scoreboard
        players={players.map((p) => ({ ...p, tilesInHand: null }))}
        currentSeat={0}
          tilesLeft={0}
        bagRemaining={{}}
        bagSize={71}
        status="finished"
      />,
    );

    expect(screen.queryByLabelText(/tiles in hand/)).toBeNull();
  });
});

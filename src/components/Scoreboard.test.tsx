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
      tileCount={12}
      tilesLeft={tilesLeft}
      bagSize={71}
      status={status}
    />,
  );
}

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
        tileCount={12}
        tilesLeft={0}
        bagSize={71}
        status="active"
      />,
    );

    expect(screen.getByLabelText("1 tile in hand").textContent).toBe("1");
  });
});

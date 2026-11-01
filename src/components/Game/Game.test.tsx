import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { Game } from "./Game";
import styles from "./Game.module.css";

/** What the server has to say, swapped per test. */
const server = vi.hoisted((): { view: unknown; refuse: boolean } => ({
  view: null,
  refuse: false,
}));
/** How many times each stand-in has mounted, and the props it last drew with. */
const seen = vi.hoisted(
  (): {
    boardMounts: number;
    rackMounts: number;
    board: Record<string, unknown>;
    rack: Record<string, unknown>;
  } => ({ boardMounts: 0, rackMounts: 0, board: {}, rack: {} }),
);

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "games:getGame" ? server.view : undefined,
  useMutation: () =>
    vi.fn(() => (server.refuse ? Promise.reject(new Error("Not your turn")) : undefined)),
  useAction: () => vi.fn(() => new Promise(() => {})),
}));

vi.mock("./useTurnReplay", () => ({
  useTurnReplay: () => ({
    history: [],
    point: null,
    board: null,
    recapActive: false,
    skipRecap: () => {},
    skipAll: () => {},
    noteSpot: undefined,
    noteTurn: undefined,
  }),
}));

// Stand-ins that count their mounts: a remount is the thing being tested for.
vi.mock("../Board/Board", () => ({
  Board: (props: Record<string, unknown>) => {
    seen.board = props;
    useEffect(() => {
      seen.boardMounts += 1;
    }, []);
    return <div data-testid="board" />;
  },
}));

vi.mock("../Rack/Rack", () => ({
  Rack: (props: Record<string, unknown>) => {
    seen.rack = props;
    useEffect(() => {
      seen.rackMounts += 1;
    }, []);
    return (
      <div data-testid="rack">
        <button type="button" onClick={props.onPass as () => void}>
          ask pass
        </button>
        <button type="button" onClick={props.onSwap as () => void}>
          ask swap
        </button>
      </div>
    );
  },
}));

const PASS_SENTENCE = "Pass your turn? A full round of passes ends the game.";
const SWAP_SENTENCE =
  "Swap all your letters for new ones? You get one swap a game, and you still play this turn.";

/** A game against one other player, on your turn, with hints on. */
function gameView(game: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    game: {
      status: "active",
      boardSize: 15,
      turnNumber: 3,
      currentSeat: 0,
      hints: true,
      playerCount: 2,
      ...game,
    },
    players: [
      { userId: "me", seat: 0, letters: ["A", "T"], letterCount: 2, score: 0, name: "Me", blanks: 0, swapped: false },
      { userId: "them", seat: 1, letters: null, letterCount: 2, score: 0, name: "Them", blanks: 0 },
    ],
    tiles: [],
    layout: "open",
    yourSeat: 0,
    viewerUserId: "me",
    tilesLeft: 40,
    unseen: {},
    seatsFilled: 2,
    canJoin: false,
    turnHeld: false,
    rematch: null,
    ...extra,
  };
}

/** A matchMedia the test can turn, as the hook's own tests do. */
function stubScreen(sideways: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: sideways };
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return state.matches;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return (next: boolean) =>
    act(() => {
      state.matches = next;
      listeners.forEach((fn) => fn());
    });
}

function draw() {
  return render(
    <Game gameId={"g" as Id<"games">} onLeave={() => {}} onOpen={() => {}} />,
  );
}

const side = () => document.querySelector<HTMLElement>(`.${styles.side}`)!;
const main = () => document.querySelector<HTMLElement>(`.${styles.main}`)!;
const rackSlot = () => document.querySelector<HTMLElement>(`.${styles.rackSlot}`)!;
const layout = () => document.querySelector<HTMLElement>(`.${styles.layout}`)!;
const hintBars = () => screen.queryAllByRole("group", { name: "Hints" });

beforeEach(() => {
  seen.boardMounts = 0;
  seen.rackMounts = 0;
  server.view = gameView();
  server.refuse = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a phone held upright", () => {
  test("keeps the one-column game", () => {
    stubScreen(false);
    draw();

    expect(layout().className).not.toContain(styles.landscape);
    expect(seen.board.fill).toBe(false);
    expect(seen.rack.columns).toBeUndefined();
    expect(seen.rack.actionsHidden).toBe(false);
    expect(main().contains(hintBars()[0])).toBe(true);
  });

  test("asks about a pass in the full sentence, under the rack", () => {
    stubScreen(false);
    draw();

    fireEvent.click(screen.getByText("ask pass"));

    const question = screen.getByRole("group", { name: "Pass your turn?" });
    expect(rackSlot().contains(question)).toBe(false);
    expect(within(question).getByText(PASS_SENTENCE).className).not.toMatch(/srOnly/);
  });
});

describe("a phone held sideways", () => {
  test("gives the board the column and the rack two tiles across", () => {
    stubScreen(true);
    draw();

    expect(layout().className).toContain(styles.landscape);
    expect(seen.board.fill).toBe(true);
    expect(seen.rack.columns).toBe(2);
  });

  test("puts the hints once in the side, and not in the main column", () => {
    stubScreen(true);
    draw();

    expect(hintBars()).toHaveLength(1);
    expect(side().contains(hintBars()[0])).toBe(true);
    expect(main().contains(hintBars()[0])).toBe(false);
  });

  test("puts each notice once, at the top of the side, in order", () => {
    stubScreen(true);
    server.view = gameView({ playerCount: 3 }, { tilesLeft: 0, seatsFilled: 2 });
    draw();

    const final = screen.getByText("The bag is empty");
    const waiting = screen.getByText("Waiting for players.");
    expect(side().contains(final)).toBe(true);
    expect(side().contains(waiting)).toBe(true);
    expect(main().contains(final)).toBe(false);
    expect(main().contains(waiting)).toBe(false);

    expect(side().firstElementChild?.contains(final)).toBe(true);
    expect(side().children[1]?.contains(waiting)).toBe(true);
  });

  test("shows a refused move in the side column, where it can be seen", async () => {
    stubScreen(true);
    server.refuse = true;
    draw();

    fireEvent.click(screen.getByText("ask pass"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Pass your turn?" })).getByRole("button", {
        name: "Pass",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(side().contains(alert)).toBe(true);
    expect(main().contains(alert)).toBe(false);
  });

  test("marks a screen with no rack, and leaves the rack out", () => {
    stubScreen(true);
    server.view = gameView({ status: "finished", turnNumber: 0 });
    draw();

    expect(layout().className).toContain(styles.noRack);
    expect(rackSlot()).toBeNull();
    expect(seen.board.fill).toBe(true);
  });

  test("moves the review bar to the side", () => {
    stubScreen(true);
    server.view = gameView({ status: "finished" });
    draw();

    fireEvent.click(screen.getByRole("button", { name: "Review turns" }));

    const scrubber = screen.getByRole("slider", { name: "Turn" });
    expect(side().contains(scrubber)).toBe(true);
    expect(main().contains(scrubber)).toBe(false);
  });

  test("keeps the review bar under the board upright", () => {
    stubScreen(false);
    server.view = gameView({ status: "finished" });
    draw();

    fireEvent.click(screen.getByRole("button", { name: "Review turns" }));

    expect(main().contains(screen.getByRole("slider", { name: "Turn" }))).toBe(true);
  });

  test.each([
    ["ask pass", "Pass your turn?", "Pass?", PASS_SENTENCE, "Pass"],
    ["ask swap", "Swap your letters?", "Swap rack?", SWAP_SENTENCE, "Swap"],
  ])("%s asks in the rack column, with the sentence kept for screen readers", (ask, name, short, sentence, confirm) => {
    stubScreen(true);
    draw();

    fireEvent.click(screen.getByText(ask));

    const question = screen.getByRole("group", { name });
    expect(rackSlot().contains(question)).toBe(true);
    expect(within(question).getByText(short).getAttribute("aria-hidden")).toBe("true");
    expect(within(question).getByText(sentence).className).toMatch(/srOnly/);
    expect(within(question).getByRole("button", { name: confirm })).toBeTruthy();
    expect(within(question).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(seen.rack.actionsHidden).toBe(true);
    expect(screen.getAllByRole("group", { name })).toHaveLength(1);
  });
});

describe("turning the phone", () => {
  test("does not remount the board or the rack, either way round", () => {
    const turn = stubScreen(false);
    draw();
    expect(seen.boardMounts).toBe(1);
    expect(seen.rackMounts).toBe(1);

    turn(true);
    expect(seen.board.fill).toBe(true);
    expect(seen.rack.columns).toBe(2);

    turn(false);
    expect(seen.board.fill).toBe(false);
    expect(seen.boardMounts).toBe(1);
    expect(seen.rackMounts).toBe(1);
  });

  test("moves the hints rather than showing them twice", () => {
    const turn = stubScreen(false);
    draw();

    turn(true);

    expect(hintBars()).toHaveLength(1);
    expect(side().contains(hintBars()[0])).toBe(true);
  });

  test("a question stays open and Cancel keeps focus", () => {
    const turn = stubScreen(false);
    draw();
    fireEvent.click(screen.getByText("ask pass"));

    turn(true);

    const question = screen.getByRole("group", { name: "Pass your turn?" });
    expect(rackSlot().contains(question)).toBe(true);
    expect(document.activeElement).toBe(
      within(question).getByRole("button", { name: "Cancel" }),
    );
  });
});

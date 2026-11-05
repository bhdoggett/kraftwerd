import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BLANK_HINT, CALLOUTS, INTRO, OFFER, plain, QUIPS, REPLAY_NOTE, scoreHint } from "../../tutorial/coach";
import { rackAt } from "../../tutorial/model";
import { IDLE_MS, LEAD_MS, SHOW_MS } from "../../tutorial/pace";
import { readStats } from "../../tutorial/progress";
import { PLAYER_SEAT, SCRIPT } from "../../tutorial/script";
import { markTutorialStarted } from "../../tutorial/seen";
import { Tutorial } from "./Tutorial";

vi.mock("../../tutorial/seen", () => ({ markTutorialStarted: vi.fn() }));

/** A fresh in-memory store each test: jsdom under some Node versions has none. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(markTutorialStarted).mockClear();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function draw() {
  const onLeave = vi.fn();
  const onNewGame = vi.fn();
  const view = render(<Tutorial onLeave={onLeave} onNewGame={onNewGame} />);
  return { onLeave, onNewGame, ...view };
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** A tap somewhere off everything: what takes a bubble down. */
const tapAway = () => fireEvent.click(document.body);

const button = (name: string | RegExp) => screen.getByRole("button", { name });

const square = (x: number, y: number) => screen.getByLabelText(new RegExp(`column ${x + 1}, row ${y + 1}$`));

const rack = () => within(document.querySelector<HTMLElement>("[data-rack]")!);
const rackLetters = () => rack().queryAllByRole("button", { name: /^[A-Z]$/ });

/** The words of every bubble on screen. */
const bubbles = () => screen.queryAllByRole("status").map((b) => b.querySelector("span")?.textContent);
const said = (...texts: string[]) => texts.map(plain);

/** The turn card's text, while an opponent's move is on it. */
const card = () => screen.queryByRole("button", { name: "Skip the replay" })?.parentElement?.textContent ?? null;

/** An opponent's move: the pause, then landed and shown. The first stack waits for Got it. */
function letPlay(turn: number) {
  advance(LEAD_MS);
  if (turn === REPLAY_NOTE.turn) fireEvent.click(button("Got it"));
  advance(SHOW_MS);
}

/** Press and let go without moving: a tap, which selects the tile. */
function tapTile(tile: Element) {
  fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(window, { pointerId: 1 });
}

/** A letter from the rack; for the blank, "blank" and the letter to name it. */
function stage(letter: string, x: number, y: number, blankAs?: string) {
  const tile =
    letter === "blank"
      ? rack().getByRole("button", { name: /^Blank tile/ })
      : rack().getAllByRole("button", { name: letter })[0];
  tapTile(tile);
  fireEvent.click(square(x, y), { detail: 1 });
  if (blankAs !== undefined) {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: blankAs }));
  }
}

/** Every tile of the turn on its ghost. */
function stageTurn(turn: number) {
  for (const p of SCRIPT[turn].placements) {
    if (p.isBlank) stage("blank", p.x, p.y, p.letter);
    else stage(p.letter, p.x, p.y);
  }
}

/** Lays the turn's tiles and plays them, putting away the play-panel note first if it is up. */
function playMove(turn: number) {
  stageTurn(turn);
  const note = screen.queryAllByRole("status").find((b) => b.textContent?.startsWith("This panel adds up"));
  if (note !== undefined) fireEvent.click(within(note).getByRole("button", { name: "Got it" }));
  fireEvent.click(button("Play"));
}

/** Plays turns from..to-1 the way a player would, taking down every callout (and keeping on past the offer). */
function playTurns(from: number, to: number) {
  for (let turn = from; turn < to; turn++) {
    if (SCRIPT[turn].seat === PLAYER_SEAT) playMove(turn);
    else letPlay(turn);
    // A move's callouts come one at a time; the offer to skip is one more.
    const taps = CALLOUTS[turn].length + (turn === OFFER.turn ? 1 : 0);
    for (let i = 0; i < taps; i++) tapAway();
  }
}

/** From the first screen to the player's first turn. */
function toTurnTwo() {
  const view = draw();
  tapAway();
  playTurns(0, 1);
  return view;
}

describe("the tutorial", () => {
  test("is a game screen with no coach card, and shows how far through it is", () => {
    draw();
    expect(screen.queryByLabelText("Coach")).toBeNull();
    expect(screen.getByLabelText("Scores")).toBeTruthy();
    expect(button("Play")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Tutorial progress: 0 of 6 moves played" })).toBeTruthy();
  });

  test("marks this device as having started it, and counts the visit", () => {
    draw();
    expect(markTutorialStarted).toHaveBeenCalledOnce();
    expect(readStats().opened).toBe(1);
  });

  test("opens on one line, with focus on its button; Isolde's move then lands whole", () => {
    draw();
    expect(bubbles()).toEqual(said(INTRO));
    expect(document.activeElement).toBe(button("Let's play"));
    // Nothing moves while the intro is up.
    advance(10_000);
    expect(card()).toBeNull();

    fireEvent.click(button("Let's play"));
    expect(bubbles()).toEqual([]);
    advance(LEAD_MS);
    // All of it at once on the turn card: who, every word, the points.
    expect(card()).toContain("Isolde");
    for (const w of SCRIPT[0].words) expect(card()).toContain(w);
    expect(card()).toContain("+15");
    expect(document.querySelector("[data-rack]")!.closest("[inert]")).not.toBeNull();
    expect(square(7, 7).getAttribute("aria-label")).toMatch(/^I, played by Isolde/);

    advance(SHOW_MS);
    expect(card()).toBeNull();
    expect(screen.getByText("Your turn")).toBeTruthy();
    // Nothing to read yet: the drag is shown first.
    expect(bubbles()).toEqual([]);
  });

  test("a tap hurries an opponent's move: it lands, then the game moves on", () => {
    draw();
    tapAway();
    tapAway();
    expect(card()).toContain("+15");
    tapAway();
    expect(card()).toBeNull();
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("the first stack holds Rostam's move until Got it, even when hurried", () => {
    toTurnTwo();
    playMove(1);
    tapAway();
    // Hurried in the pause: it lands and stops on the note.
    tapAway();
    expect(bubbles()).toEqual(said(REPLAY_NOTE.text));
    expect(square(7, 9).getAttribute("aria-label")).toMatch(/^K, played by Rostam/);
    expect(square(7, 9).hasAttribute("data-spot")).toBe(true);
    expect(card()).toContain(QUIPS[2]);
    advance(20_000);
    expect(bubbles()).toEqual(said(REPLAY_NOTE.text));
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    advance(SHOW_MS);
    expect(screen.getByText("Isolde's turn")).toBeTruthy();
  });

  test("opponents' turns play by themselves, one after another", () => {
    draw();
    tapAway();
    playTurns(0, 8);
    expect(CALLOUTS[8]).toHaveLength(0);
    letPlay(8);
    expect(square(7, 1).getAttribute("aria-label")).toMatch(/^P, played by Rostam/);
    expect(screen.getByText("Isolde's turn")).toBeTruthy();
    advance(LEAD_MS);
    expect(card()).toContain(QUIPS[9]);
    advance(SHOW_MS);
    expect(square(13, 1).getAttribute("aria-label")).toMatch(/^R, played by Isolde/);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("a move's callouts come one at a time; the last says what comes next", () => {
    draw();
    tapAway();
    playTurns(0, 4);
    playMove(4);
    expect(bubbles()).toEqual(said(CALLOUTS[4][0].text));
    expect(square(13, 13).hasAttribute("data-spot")).toBe(true);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual(said(CALLOUTS[4][1].text));
    fireEvent.click(button("Next: Rostam's turn"));
    expect(bubbles()).toEqual([]);
    expect(screen.getByText("Rostam's turn")).toBeTruthy();
  });

  test("starting a drag takes a callout down, and counts once", () => {
    toTurnTwo();
    playMove(1);
    expect(bubbles()).toHaveLength(1);
    fireEvent.pointerDown(rackLetters()[0], { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(bubbles()).toEqual([]);
    fireEvent.click(rackLetters()[0]);
    expect(card()).toBeNull();
    expect(screen.getByText("Rostam's turn")).toBeTruthy();
  });

  test("the player's turn shows the whole hand, with ghosts only for this move", () => {
    toTurnTwo();
    expect(screen.getAllByLabelText(/place [A-Z] here/)).toHaveLength(SCRIPT[1].placements.length);
    expect(rackLetters().map((b) => b.textContent).sort()).toEqual([...rackAt(1).letters].sort());
    expect(rackLetters()).toHaveLength(7);
    expect(rack().getByRole("button", { name: "Blank tile, 3 left" })).toBeTruthy();
  });

  test("the blank's ghost and the rack's blank pulse as a pair; the hint comes after two tiles", () => {
    toTurnTwo();
    const blank = [...document.querySelectorAll("[data-ghost]")].filter((g) => g.hasAttribute("data-blank"));
    expect(blank.map((g) => g.textContent)).toEqual(["S"]);
    expect(rack().getByRole("button", { name: /^Blank tile/ }).getAttribute("data-hint")).toBe("blank");
    expect(bubbles()).toEqual([]);
    stage("A", 7, 9);
    expect(bubbles()).toEqual([]);
    stage("T", 8, 7);
    expect(bubbles()).toEqual(said(BLANK_HINT));

    stage("blank", 9, 7, "S");
    expect(rack().getByRole("button", { name: /^Blank tile/ }).getAttribute("data-hint")).toBeNull();
    expect(document.querySelectorAll("[data-ghost][data-blank]")).toHaveLength(0);
    expect(bubbles()).toEqual([]);
  });

  test("the blank hint goes on Got it, a tap anywhere, or a drag", () => {
    const twoDown = () => {
      toTurnTwo();
      stage("A", 7, 9);
      stage("T", 8, 7);
      expect(bubbles()).toEqual(said(BLANK_HINT));
    };
    twoDown();
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    cleanup();
    twoDown();
    tapAway();
    expect(bubbles()).toEqual([]);
    cleanup();
    twoDown();
    fireEvent.pointerDown(rackLetters()[0], { pointerId: 1, clientX: 10, clientY: 10 });
    expect(bubbles()).toEqual([]);
  });

  test("the blank hint never shows once the blank is down", () => {
    toTurnTwo();
    stage("blank", 9, 7, "S");
    stage("A", 7, 9);
    stage("T", 8, 7);
    expect(bubbles()).toEqual([]);
  });

  test("the drag is shown on the first turn until a tile is touched", () => {
    toTurnTwo();
    expect(document.querySelector("[data-hand]")).not.toBeNull();
    fireEvent.pointerDown(rackLetters()[0], { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(document.querySelector("[data-hand]")).toBeNull();
  });

  test("two early presses of Play bring the drag back", () => {
    toTurnTwo();
    tapTile(rackLetters()[0]);
    expect(document.querySelector("[data-hand]")).toBeNull();
    fireEvent.click(button("Play"));
    expect(document.querySelector("[data-hand]")).toBeNull();
    fireEvent.click(button("Play"));
    expect(document.querySelector("[data-hand]")).not.toBeNull();
  });

  test("sitting still brings a nudge: the next ghost lit, its tile wiggling", () => {
    toTurnTwo();
    expect(document.querySelector("[data-spot]")).toBeNull();
    advance(IDLE_MS);
    const first = SCRIPT[1].placements[0];
    expect(square(first.x, first.y).hasAttribute("data-spot")).toBe(true);
    const wiggling = rack().getAllByRole("button").filter((b) => b.hasAttribute("data-nudge"));
    expect(wiggling.map((b) => b.textContent)).toEqual([first.letter]);
    // Laying a tile starts the clock again.
    stage(first.letter, first.x, first.y);
    expect(document.querySelector("[data-nudge]")).toBeNull();
  });

  test("a blank asks for its letter, as in a game, with the wanted one lit", () => {
    toTurnTwo();
    stage("blank", 9, 7);
    const picker = within(screen.getByRole("dialog"));
    const lit = picker.getAllByRole("button").filter((b) => b.hasAttribute("data-suggested"));
    expect(lit.map((b) => b.textContent)).toEqual(["S"]);
    fireEvent.click(picker.getByRole("button", { name: "S" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(square(9, 7).getAttribute("aria-label")).toMatch(/^S, your tile/);
  });

  test("a blank named the wrong letter is caught on Play", () => {
    toTurnTwo();
    stage("blank", 9, 7, "X");
    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual(["That square wants S, not X."]);
  });

  test("Play pressed early says what is missing; Got it puts it away", () => {
    toTurnTwo();
    const play = button("Play");
    expect(play.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(play);
    // The press on Play also took the blank hint down.
    expect(bubbles()).toEqual(["6 more tiles to place."]);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("a tile off its ghost is ringed, lit and explained where it lies", () => {
    toTurnTwo();
    stage("B", 8, 10);
    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual(["The B goes on the glowing square one square right."]);
    expect(screen.getByRole("status").getAttribute("data-points-at")).toBe("8,10");
    expect(square(8, 10).getAttribute("aria-label")).toMatch(/not valid/);
    expect(square(8, 10).hasAttribute("data-spot")).toBe(true);
    // Moving on takes the nudge down (two tiles down now brings the blank hint).
    stage("T", 8, 7);
    expect(bubbles()).toEqual(said(BLANK_HINT));
  });

  test("staged tiles are scored and ringed as a game rings them", () => {
    toTurnTwo();
    stage("A", 7, 9);
    expect(square(7, 9).getAttribute("aria-label")).toMatch(/in a valid word/);
    expect(screen.getByText(/This play scores/).textContent).toContain("4");
    stage("B", 9, 10);
    expect(square(9, 10).getAttribute("aria-label")).toMatch(/in a valid word|not valid/);
  });

  test("the play panel is explained once the move is right, and Play waits for that", () => {
    toTurnTwo();
    expect(screen.queryByText(/This play scores/)).toBeNull();
    stage("A", 7, 9);
    expect(bubbles()).not.toContain(plain(scoreHint(53)));
    expect(screen.getByText(/This play scores/).closest("[data-lit]")).toBeNull();
    for (const p of SCRIPT[1].placements) {
      if (p.letter === "A") continue;
      if (p.isBlank) stage("blank", p.x, p.y, p.letter);
      else stage(p.letter, p.x, p.y);
    }
    expect(screen.getByText(/This play scores/).textContent).toContain("53");
    expect(bubbles()).toEqual(said(scoreHint(53)));
    // The panel is lit while the note talks about it, and only then.
    expect(screen.getByText(/This play scores/).closest("[data-lit]")).not.toBeNull();
    expect(screen.getByRole("status").getAttribute("data-side")).not.toBe("below");
    // The first press on Play only puts the note away.
    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual([]);
    expect(screen.getByText(/This play scores/).closest("[data-lit]")).toBeNull();
    expect(screen.getByText("Your turn")).toBeTruthy();
    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual(said(CALLOUTS[1][0].text));
    // Once played, as in a game, the panel goes.
    expect(screen.queryByText(/This play scores/)).toBeNull();
  });

  test("a good Play scores, outlines and celebrates the 3×3, and refills the rack", () => {
    toTurnTwo();
    playMove(1);
    expect(screen.getByLabelText("Scores").textContent).toContain("53");
    expect(square(7, 7).getAttribute("aria-label")).toMatch(/in a valid word/);
    // "+33" rises off the square (the callout says it too).
    expect(screen.getAllByText("+33").some((el) => el.closest("[role=status]") === null)).toBe(true);
    expect(rackLetters().map((b) => b.textContent).sort()).toEqual([...rackAt(2).letters].sort());
    expect(rack().getByRole("button", { name: "Blank tile, 2 left" })).toBeTruthy();
    expect(screen.queryAllByLabelText(/place [A-Z] here/)).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Tutorial progress: 1 of 6 moves played" })).toBeTruthy();
  });

  test("a real O and the blank O swap places on turn 5", () => {
    draw();
    tapAway();
    playTurns(0, 4);
    for (const p of SCRIPT[4].placements) {
      if (p.letter === "O") continue;
      stage(p.letter, p.x, p.y);
    }
    stage("O", 12, 10);
    stage("blank", 13, 12, "O");
    expect(screen.getByText(/This play scores/).textContent).toContain("40");
  });

  test("after the third move: keep playing, or skip straight to the scores", () => {
    draw();
    tapAway();
    playTurns(0, OFFER.turn);
    playMove(OFFER.turn);
    for (const _ of CALLOUTS[OFFER.turn]) tapAway();
    expect(bubbles()).toEqual(said(OFFER.text));
    fireEvent.click(button("Skip to the end"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Isolde won")).toBeTruthy();
    expect(readStats().skipped).toBe(1);
  });

  test("Isolde going out is pointed out, and the button says your move is next", () => {
    draw();
    tapAway();
    playTurns(0, 12);
    letPlay(12);
    expect(bubbles()).toEqual(said(CALLOUTS[12][0].text));
    fireEvent.click(button("Next: your move"));
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("Enter on a focused button moves on once, not twice", () => {
    toTurnTwo();
    playMove(1);
    const next = button("Next: Rostam's turn");
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: "Enter" });
    expect(bubbles()).toEqual(said(CALLOUTS[1][0].text));
    fireEvent.click(next);
    expect(bubbles()).toEqual([]);
    // Enter away from any control is a tap: here it hurries Rostam to his note.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(bubbles()).toEqual(said(REPLAY_NOTE.text));
  });

  test("a return picks up where the player left off, or starts over", () => {
    const first = draw();
    tapAway();
    playTurns(0, 4);
    first.unmount();

    const again = draw();
    expect(bubbles()).toEqual(said("Welcome back! Pick up at **your move 2 of 6**, or start over."));
    fireEvent.click(button("Continue"));
    expect(screen.getByText("Your turn")).toBeTruthy();
    expect(screen.getAllByLabelText(/place [A-Z] here/)).toHaveLength(SCRIPT[4].placements.length);
    again.unmount();

    draw();
    fireEvent.click(button("Start over"));
    expect(bubbles()).toEqual([]);
    advance(LEAD_MS);
    expect(card()).toContain("Isolde");
    // Starting over forgets the place.
    cleanup();
    draw();
    expect(bubbles()).toEqual(said(INTRO));
  });

  test("the sound switch is off at first and remembers being turned on", () => {
    const first = draw();
    expect(button("Sound off").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Sound off"));
    expect(button("Sound on").getAttribute("aria-pressed")).toBe("true");
    // Not a tap: the intro is still up.
    expect(bubbles()).toEqual(said(INTRO));
    first.unmount();
    draw();
    expect(button("Sound on")).toBeTruthy();
  });

  test("Leave tutorial leaves", () => {
    const { onLeave } = draw();
    fireEvent.click(button("Leave tutorial"));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  test("the whole game ends on the final scores and what was learned", () => {
    const { onLeave, onNewGame } = draw();
    tapAway();
    playTurns(0, SCRIPT.length);

    expect(rackLetters()).toHaveLength(0);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Isolde won")).toBeTruthy();
    expect(dialog.getByText(/Rostam's last tile carried him past you/)).toBeTruthy();
    const scores = within(dialog.getAllByRole("list")[0])
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(scores).toEqual(["Isolde264", "Rostam253", "You239"]);
    expect(dialog.getByRole("list", { name: "You learned" })).toBeTruthy();
    expect(readStats().finished).toBe(1);

    fireEvent.click(dialog.getByRole("button", { name: "Play a real game" }));
    expect(onNewGame).toHaveBeenCalledOnce();
    fireEvent.click(dialog.getByRole("button", { name: "Back to lobby" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BLANK_HINT, CALLOUTS, INTRO, REPLAY_NOTE, scoreHint } from "../../tutorial/coach";
import { rackAt, replaySteps } from "../../tutorial/model";
import { RECAP_LEAD_MS, RECAP_PLAY_MS, RECAP_POINTS_MS } from "../Game/replayTiming";
import { PLAYER_SEAT, SCRIPT } from "../../tutorial/script";
import { markTutorialStarted } from "../../tutorial/seen";
import { Tutorial } from "./Tutorial";

vi.mock("../../tutorial/seen", () => ({ markTutorialStarted: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(markTutorialStarted).mockClear();
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

/**
 * An opponent's whole move, replayed at a game's pace: the pause, each spot,
 * the points. The first stack stops the replay on a note, read with Got it.
 */
function letPlay(turn: number) {
  advance(RECAP_LEAD_MS);
  for (const s of replaySteps(turn)) {
    if (turn === REPLAY_NOTE.turn && !s.total && s.cells.has(REPLAY_NOTE.cell)) {
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    }
    advance(s.total ? RECAP_POINTS_MS : RECAP_PLAY_MS);
  }
}

/** A tap somewhere off everything: what takes a bubble down. */
const tapAway = () => fireEvent.click(document.body);

const button = (name: string) => screen.getByRole("button", { name });

const square = (x: number, y: number) => screen.getByLabelText(new RegExp(`column ${x + 1}, row ${y + 1}$`));

const rack = () => within(document.querySelector<HTMLElement>("[data-rack]")!);
const rackLetters = () => rack().queryAllByRole("button", { name: /^[A-Z]$/ });

const bubbles = () => screen.queryAllByRole("status").map((b) => b.querySelector("span")?.textContent);

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

/** Plays turns from..to-1 the way a player would, taking down every callout. */
function playTurns(from: number, to: number) {
  for (let turn = from; turn < to; turn++) {
    if (SCRIPT[turn].seat === PLAYER_SEAT) {
      stageTurn(turn);
      fireEvent.click(button("Play"));
    } else {
      letPlay(turn);
    }
    // A move's callouts come one at a time.
    for (const _ of CALLOUTS[turn]) tapAway();
  }
}

/** From the first screen to the player's first turn. */
function toTurnTwo() {
  draw();
  tapAway();
  playTurns(0, 1);
}

describe("the tutorial", () => {
  test("is a game screen with no coach card", () => {
    draw();
    expect(screen.queryByLabelText("Coach")).toBeNull();
    expect(screen.queryByText(/\d+ \/ 17/)).toBeNull();
    expect(screen.getByLabelText("Scores")).toBeTruthy();
    expect(button("Play")).toBeTruthy();
  });

  test("marks this device as having started it", () => {
    draw();
    expect(markTutorialStarted).toHaveBeenCalledOnce();
  });

  test("opens on one line that a tap takes down, then Isolde's move replays as in a game", () => {
    draw();
    expect(bubbles()).toEqual([INTRO]);
    // Nothing moves while the intro is up.
    advance(10_000);
    expect(screen.queryByRole("button", { name: "Skip the replay" })).toBeNull();

    tapAway();
    expect(bubbles()).toEqual([]);
    advance(RECAP_LEAD_MS);
    // The turn card, in the rack's place: who, and what this spot made.
    const card = screen.getByRole("button", { name: "Skip the replay" }).parentElement!;
    expect(card.textContent).toContain("Isolde");
    expect(card.textContent).toContain(replaySteps(0)[0].words.join(", "));
    expect(document.querySelector("[data-rack]")!.closest("[inert]")).not.toBeNull();
    expect(square(7, 7).getAttribute("aria-label")).toMatch(/^I, played by Isolde/);

    for (const s of replaySteps(0).slice(0, -1)) advance(s.total ? RECAP_POINTS_MS : RECAP_PLAY_MS);
    expect(card.textContent).toContain("+15");
    advance(RECAP_POINTS_MS);
    // Her move needs no explaining: straight on to the player's turn, where
    // only the rack's blank is pointed out.
    expect(screen.queryByRole("button", { name: "Skip the replay" })).toBeNull();
    expect(bubbles()).toEqual([BLANK_HINT]);
    expect(screen.getByText("Your turn")).toBeTruthy();
    expect(document.querySelector("[data-rack]")!.closest("[inert]")).toBeNull();
  });

  test("a callout's Got it button moves the game on", () => {
    draw();
    expect(screen.getAllByRole("button", { name: "Got it" })).toHaveLength(1);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    advance(RECAP_LEAD_MS);
    expect(screen.getByRole("button", { name: "Skip the replay" })).toBeTruthy();
  });

  test("a tap skips the rest of a replay", () => {
    draw();
    tapAway();
    advance(RECAP_LEAD_MS);
    tapAway();
    expect(screen.queryByRole("button", { name: "Skip the replay" })).toBeNull();
    expect(screen.getByText("Your turn")).toBeTruthy();
    expect(square(9, 9).getAttribute("aria-label")).toMatch(/^A, played by Isolde/);
  });

  test("the player's move gets callouts that sit until a tap", () => {
    toTurnTwo();
    stageTurn(1);
    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual(CALLOUTS[1].map((c) => c.text));
    // One Got it, on the last line.
    expect(screen.getAllByRole("button", { name: "Got it" })).toHaveLength(1);
    // It waits as long as it takes.
    advance(20_000);
    expect(bubbles()).toHaveLength(1);

    tapAway();
    expect(bubbles()).toEqual([]);
    expect(screen.getByText("Rostam's turn")).toBeTruthy();
  });

  test("starting a drag takes the callouts down too", () => {
    toTurnTwo();
    stageTurn(1);
    fireEvent.click(button("Play"));
    expect(bubbles()).toHaveLength(1);
    fireEvent.pointerDown(rackLetters()[0], { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(bubbles()).toEqual([]);
    // The press counted once: Rostam's replay is under way, not skipped.
    fireEvent.click(rackLetters()[0]);
    advance(RECAP_LEAD_MS);
    expect(screen.getByRole("button", { name: "Skip the replay" })).toBeTruthy();
  });

  test("the play panel scores the move as it is laid, and is explained once it is right", () => {
    toTurnTwo();
    expect(screen.queryByText(/This play scores/)).toBeNull();
    stage("A", 7, 9);
    expect(screen.getByText(/This play scores/)).toBeTruthy();
    // Not yet: the move is not all down.
    expect(bubbles()).not.toContain(scoreHint(53));
    for (const p of SCRIPT[1].placements) {
      if (p.letter === "A") continue;
      if (p.isBlank) stage("blank", p.x, p.y, p.letter);
      else stage(p.letter, p.x, p.y);
    }
    expect(screen.getByText(/This play scores/).textContent).toContain("53");
    expect(screen.getByText("Square bonus")).toBeTruthy();
    // Every tile right, Play not pressed: a note says what the panel is for.
    expect(bubbles()).toEqual([scoreHint(53)]);
    // It sits with the panel, pointing at it.
    expect(screen.getByRole("status").parentElement?.querySelector("section")?.textContent).toContain("This play scores");
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    fireEvent.click(button("Play"));
    // Once played, as in a game, the panel goes.
    expect(screen.queryByText(/This play scores/)).toBeNull();
  });

  test("the player's turn shows the whole hand, with ghosts only for this move", () => {
    toTurnTwo();
    expect(screen.getAllByLabelText(/place [A-Z] here/)).toHaveLength(SCRIPT[1].placements.length);
    expect(rackLetters().map((b) => b.textContent).sort()).toEqual([...rackAt(1).letters].sort());
    expect(rackLetters()).toHaveLength(7);
    expect(rack().getByRole("button", { name: "Blank tile, 3 left" })).toBeTruthy();
  });

  test("the blank's ghost and the rack's blank pulse as a pair until it is laid", () => {
    toTurnTwo();
    const ghosts = document.querySelectorAll("[data-ghost]");
    const blank = [...ghosts].filter((g) => g.hasAttribute("data-blank"));
    expect(blank).toHaveLength(1);
    expect(blank[0].textContent).toBe("S");
    expect(rack().getByRole("button", { name: /^Blank tile/ }).getAttribute("data-hint")).toBe("blank");
    // And a line points at the rack's blank, saying what it is.
    expect(bubbles()).toEqual([BLANK_HINT]);
    expect(screen.getByRole("status").getAttribute("data-points-at")).toBeNull();

    stage("blank", 9, 7, "S");
    expect(rack().getByRole("button", { name: /^Blank tile/ }).getAttribute("data-hint")).toBeNull();
    expect(bubbles()).toEqual([]);
    expect(document.querySelectorAll("[data-ghost][data-blank]")).toHaveLength(0);
  });

  test("every hint has Got it: the blank hint and a nudge go away with it", () => {
    toTurnTwo();
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    // Still pulsing, just no longer explained.
    expect(rack().getByRole("button", { name: /^Blank tile/ }).getAttribute("data-hint")).toBe("blank");

    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual(["6 more tiles to place."]);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("Play pressed early says what is missing in a bubble over the board", () => {
    toTurnTwo();
    const play = button("Play");
    expect(play.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(play);
    // The press on Play also took the blank hint down.
    expect(bubbles()).toEqual(["6 more tiles to place."]);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("a tile off its ghost is ringed and explained where it lies", () => {
    toTurnTwo();
    // The B belongs on 9,10; one square left of that is no ghost.
    stage("B", 8, 10);
    fireEvent.click(button("Play"));
    expect(bubbles()).toEqual(["The B goes on the glowing square one square right."]);
    expect(screen.getAllByRole("status")[0].getAttribute("data-points-at")).toBe("8,10");
    expect(square(8, 10).getAttribute("aria-label")).toMatch(/not valid/);
    // Moving a tile takes the nudge down.
    stage("T", 8, 7);
    expect(bubbles()).toEqual([]);
  });

  test("staged tiles are scored and ringed as a game rings them", () => {
    toTurnTwo();
    // The A under PIC makes PICA, a real word: green, and priced.
    stage("A", 7, 9);
    expect(square(7, 9).getAttribute("aria-label")).toMatch(/in a valid word/);
    expect(screen.getByText(/This play scores/).textContent).toContain("4");
    // The B on its own, touching nothing, is not a word.
    stage("B", 9, 10);
    expect(square(9, 10).getAttribute("aria-label")).toMatch(/not valid/);
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

  test("a good Play scores, outlines the new 3×3 and refills the rack at once", () => {
    toTurnTwo();
    stageTurn(1);
    const play = button("Play");
    expect(play.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(play);

    expect(screen.getByLabelText("Scores").textContent).toContain("53");
    expect(bubbles()).toEqual(CALLOUTS[1].map((c) => c.text));
    expect(square(7, 7).getAttribute("aria-label")).toMatch(/in a valid word/);
    expect(rackLetters().map((b) => b.textContent).sort()).toEqual([...rackAt(2).letters].sort());
    expect(rack().getByRole("button", { name: "Blank tile, 2 left" })).toBeTruthy();
    expect(screen.queryAllByLabelText(/place [A-Z] here/)).toHaveLength(0);
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
    fireEvent.click(button("Play"));
    // Two callouts, one at a time, each with its Got it.
    expect(bubbles()).toEqual([CALLOUTS[4][0].text]);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([CALLOUTS[4][1].text]);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    expect(screen.getByText("Rostam's turn")).toBeTruthy();
  });

  test("opponents' turns play by themselves, one after another", () => {
    draw();
    tapAway();
    playTurns(0, 8);
    // Rostam's turn 9 and Isolde's turn 10 replay back to back with no tap.
    expect(CALLOUTS[8]).toHaveLength(0);
    letPlay(8);
    expect(square(7, 1).getAttribute("aria-label")).toMatch(/^P, played by Rostam/);
    expect(screen.getByText("Isolde's turn")).toBeTruthy();
    letPlay(9);
    expect(square(13, 1).getAttribute("aria-label")).toMatch(/^R, played by Isolde/);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("the replay stops on the first stack until Got it, then carries on", () => {
    draw();
    tapAway();
    playTurns(0, 2);
    advance(RECAP_LEAD_MS);
    const steps = replaySteps(2);
    const at = steps.findIndex((s) => !s.total && s.cells.has(REPLAY_NOTE.cell));
    for (const s of steps.slice(0, at)) advance(s.total ? RECAP_POINTS_MS : RECAP_PLAY_MS);
    expect(bubbles()).toEqual([REPLAY_NOTE.text]);
    // It holds there.
    advance(20_000);
    expect(bubbles()).toEqual([REPLAY_NOTE.text]);
    expect(screen.getByText("Rostam's turn")).toBeTruthy();

    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    // The replay is still going (not skipped)...
    expect(screen.getByRole("button", { name: "Skip the replay" })).toBeTruthy();
    for (const s of steps.slice(at)) advance(s.total ? RECAP_POINTS_MS : RECAP_PLAY_MS);
    // ...and Isolde's turn 4 follows by itself, with no note.
    expect(screen.getByText("Isolde's turn")).toBeTruthy();
    letPlay(3);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("skipping Rostam's replay early stops on the stack note rather than past it", () => {
    draw();
    tapAway();
    playTurns(0, 2);
    // A tap in the pause before the first spot.
    tapAway();
    expect(bubbles()).toEqual([REPLAY_NOTE.text]);
    expect(square(7, 9).getAttribute("aria-label")).toMatch(/^K, played by Rostam/);
    advance(20_000);
    expect(bubbles()).toEqual([REPLAY_NOTE.text]);
    fireEvent.click(button("Got it"));
    expect(bubbles()).toEqual([]);
    // Once read, a tap skips the rest as usual.
    tapAway();
    expect(screen.queryByRole("button", { name: "Skip the replay" })).toBeNull();
    expect(screen.getByText("Isolde's turn")).toBeTruthy();
  });

  test("Enter on a focused Got it moves on once, not twice", () => {
    toTurnTwo();
    stageTurn(1);
    fireEvent.click(button("Play"));
    const got = button("Got it");
    got.focus();
    // A button answers Enter with a click of its own: the key alone does nothing.
    fireEvent.keyDown(got, { key: "Enter" });
    expect(bubbles()).toEqual([CALLOUTS[1][0].text]);
    fireEvent.click(got);
    expect(bubbles()).toEqual([]);
    expect(screen.getByText("Rostam's turn")).toBeTruthy();
    // Enter away from any control is a tap: here it skips Rostam's replay to his note.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(bubbles()).toEqual([REPLAY_NOTE.text]);
  });

  test("the blank hint goes on a tap anywhere, or when a drag starts", () => {
    toTurnTwo();
    expect(bubbles()).toEqual([BLANK_HINT]);
    tapAway();
    expect(bubbles()).toEqual([]);

    cleanup();
    toTurnTwo();
    expect(bubbles()).toEqual([BLANK_HINT]);
    fireEvent.pointerDown(rackLetters()[0], { pointerId: 1, clientX: 10, clientY: 10 });
    expect(bubbles()).toEqual([]);
  });

  test("Isolde going out is pointed out, since she is skipped from then on", () => {
    draw();
    tapAway();
    playTurns(0, 12);
    letPlay(12);
    expect(bubbles()).toEqual(CALLOUTS[12].map((c) => c.text));
    tapAway();
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  test("starts over when it is opened again", () => {
    const first = draw();
    tapAway();
    letPlay(0);
    first.unmount();
    draw();
    expect(bubbles()).toEqual([INTRO]);
  });

  test("Leave tutorial leaves", () => {
    const { onLeave } = draw();
    fireEvent.click(button("Leave tutorial"));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  test("the whole game ends on the final scores", () => {
    const { onLeave, onNewGame } = draw();
    tapAway();
    playTurns(0, SCRIPT.length);

    expect(rackLetters()).toHaveLength(0);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Isolde won")).toBeTruthy();
    expect(dialog.getByText(/Rostam's last tile carried him past you/)).toBeTruthy();
    const scores = dialog.getAllByRole("listitem").map((li) => li.textContent);
    expect(scores).toEqual(["Isolde264", "Rostam253", "You239"]);

    fireEvent.click(dialog.getByRole("button", { name: "New game" }));
    expect(onNewGame).toHaveBeenCalledOnce();
    fireEvent.click(dialog.getByRole("button", { name: "Back to lobby" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});

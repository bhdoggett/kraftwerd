import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "../Modal/Modal";
import { tutorialStartedHere, markTutorialStarted } from "../../tutorial/seen";
import { TutorialDialog, TutorialNotice } from "./TutorialNotice";
import { axeViolations } from "../../test/axe";

const q = vi.hoisted(() => {
  const state: { viewer: unknown; results: unknown; friends: unknown; mark: () => void } = {
    viewer: undefined,
    results: undefined,
    friends: undefined,
    mark: () => undefined,
  };
  return state;
});

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = String((ref as { name?: string }).name ?? "");
    return name.includes("viewer") ? q.viewer : name.includes("pendingResults") ? q.results : q.friends;
  },
  useMutation: () => q.mark,
}));
vi.mock("../../../convex/_generated/api", () => ({
  api: {
    users: { viewer: { name: "viewer" }, markTutorialSeen: {} },
    games: { pendingResults: { name: "pendingResults" } },
    friends: { listFriends: { name: "listFriends" } },
  },
}));

/** Happy-dom here has no usable storage, so stand one in. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
  };
}

const eligible = { tutorialSeen: false, needsDisplayName: false, rulesSeen: 9999 };

beforeEach(() => {
  q.viewer = eligible;
  q.results = [];
  q.friends = { incoming: [] };
  q.mark = vi.fn();
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("sessionStorage", fakeStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the tutorial notice", () => {
  test("shows when eligible and nothing else is open", async () => {
    render(<TutorialNotice />);
    expect(await screen.findByText("New here?")).toBeTruthy();
  });

  test("Not now records it and closes at once", async () => {
    render(<TutorialNotice />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(q.mark).toHaveBeenCalledOnce();
    expect(screen.queryByText("New here?")).toBeNull();
  });

  test("waits while a game result is pending", async () => {
    q.results = [{ gameId: "g" }];
    render(<TutorialNotice />);
    await act(async () => {});
    expect(screen.queryByText("New here?")).toBeNull();
  });

  test("waits while friend requests would show, but not when snoozed", async () => {
    q.friends = { incoming: [{ friendshipId: "f", name: "Bo" }] };
    const { unmount } = render(<TutorialNotice />);
    await act(async () => {});
    expect(screen.queryByText("New here?")).toBeNull();
    unmount();

    localStorage.setItem("kraftwerd:friend-requests-snoozed-until", String(Date.now() + 60_000));
    render(<TutorialNotice />);
    expect(await screen.findByText("New here?")).toBeTruthy();
  });

  test("waits while data is loading, the name prompt or a guest game is pending", async () => {
    q.friends = undefined;
    const a = render(<TutorialNotice />);
    await act(async () => {});
    expect(screen.queryByText("New here?")).toBeNull();
    a.unmount();

    q.friends = { incoming: [] };
    q.viewer = { ...eligible, needsDisplayName: true };
    const b = render(<TutorialNotice />);
    await act(async () => {});
    expect(screen.queryByText("New here?")).toBeNull();
    b.unmount();

    q.viewer = eligible;
    sessionStorage.setItem("kraftwerd:play-first", "solo");
    render(<TutorialNotice />);
    await act(async () => {});
    expect(screen.queryByText("New here?")).toBeNull();
  });

  test("waits while another modal is open, then shows once it closes", async () => {
    const other = render(
      <Modal>
        <h2>Other</h2>
      </Modal>,
    );
    render(<TutorialNotice />);
    await act(async () => {});
    expect(screen.queryByText("New here?")).toBeNull();
    other.unmount();
    expect(await screen.findByText("New here?")).toBeTruthy();
  });

  test("started here: marks it seen silently and shows nothing", async () => {
    markTutorialStarted();
    render(<TutorialNotice />);
    await act(async () => {});
    expect(q.mark).toHaveBeenCalled();
    expect(screen.queryByText("New here?")).toBeNull();
  });
});

describe("tutorialStartedHere", () => {
  test("reads as false when the store throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(tutorialStartedHere()).toBe(false);
  });
});

describe("the tutorial dialog", () => {
  test("its buttons call their handlers", () => {
    const onTake = vi.fn();
    const onLater = vi.fn();
    render(<TutorialDialog onTake={onTake} onLater={onLater} />);

    fireEvent.click(screen.getByRole("button", { name: "Take the tutorial" }));
    expect(onTake).toHaveBeenCalledOnce();
    expect(onLater).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onLater).toHaveBeenCalledOnce();
  });

  test("has no axe violations", async () => {
    render(<TutorialDialog onTake={vi.fn()} onLater={vi.fn()} />);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { markTutorialStarted, tutorialStartedHere } from "./seen";

/** A localStorage stand-in: this project runs these tests in plain node. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => items.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void items.set(k, v)),
    items,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whether this device has started the tutorial", () => {
  test("not until it has been marked", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(tutorialStartedHere()).toBe(false);
    markTutorialStarted();
    expect(tutorialStartedHere()).toBe(true);
    expect(storage.items.has("kraftwerd:tutorial-started")).toBe(true);
  });

  test("a store that throws on read reads as not started", () => {
    const storage = fakeStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.stubGlobal("window", { localStorage: storage });

    expect(tutorialStartedHere()).toBe(false);
  });

  test("a store that throws on write is ignored", () => {
    const storage = fakeStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("window", { localStorage: storage });

    expect(() => markTutorialStarted()).not.toThrow();
    expect(tutorialStartedHere()).toBe(false);
  });

  test("no store at all reads as not started", () => {
    vi.stubGlobal("window", undefined);
    expect(() => markTutorialStarted()).not.toThrow();
    expect(tutorialStartedHere()).toBe(false);
  });
});

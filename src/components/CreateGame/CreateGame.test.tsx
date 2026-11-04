import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreateGame } from "./CreateGame";

vi.mock("convex/react", () => ({ useQuery: () => ({ friends: [] }) }));

afterEach(cleanup);

describe("starting a game of robots", () => {
  test("has no hints checkbox, and starts with hints off", () => {
    const onStart = vi.fn();
    render(<CreateGame onStart={onStart} onCancel={vi.fn()} starting={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Robots/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/hints/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart.mock.calls[0][5]).toBe(false);
  });
});

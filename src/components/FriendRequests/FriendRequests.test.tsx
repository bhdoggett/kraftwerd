import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { FriendRequestsDialog } from "./FriendRequests";

afterEach(cleanup);

const requests = [
  { friendshipId: "f1" as Id<"friendships">, name: "Bo" },
  { friendshipId: "f2" as Id<"friendships">, name: "Cy" },
];

describe("the friend requests reminder", () => {
  test("names everyone waiting on an answer", () => {
    render(<FriendRequestsDialog requests={requests} onAnswer={vi.fn()} onLater={vi.fn()} />);
    expect(screen.getByText("2 people want to be friends")).toBeDefined();
    expect(screen.getByText("Bo")).toBeDefined();
    expect(screen.getByText("Cy")).toBeDefined();
  });

  test("answers each request on the spot", () => {
    const onAnswer = vi.fn();
    render(<FriendRequestsDialog requests={requests} onAnswer={onAnswer} onLater={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]!);
    expect(onAnswer).toHaveBeenCalledWith("f1", true);
    fireEvent.click(screen.getAllByRole("button", { name: "Decline" })[1]!);
    expect(onAnswer).toHaveBeenCalledWith("f2", false);
  });

  test("Later puts it away", () => {
    const onLater = vi.fn();
    render(<FriendRequestsDialog requests={requests} onAnswer={vi.fn()} onLater={onLater} />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalled();
  });
});

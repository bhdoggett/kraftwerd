import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TutorialDialog } from "./TutorialNotice";
import { axeViolations } from "../../test/axe";

afterEach(cleanup);

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

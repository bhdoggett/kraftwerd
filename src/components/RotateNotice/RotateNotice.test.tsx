import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { RotateNotice } from "./RotateNotice";
import { axeViolations } from "../../test/axe";

afterEach(cleanup);

describe("RotateNotice", () => {
  test("asks for the phone to be turned upright", () => {
    render(<RotateNotice />);
    expect(screen.getByText("Turn your phone upright to play.")).toBeTruthy();
  });

  test("has no axe violations", async () => {
    const { container } = render(<RotateNotice />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

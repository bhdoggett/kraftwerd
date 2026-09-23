import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RuleChangesDialog } from "./RuleChanges";

afterEach(cleanup);

describe("the rule changes dialog", () => {
  test("lists every change and closes on Got it", () => {
    const onClose = vi.fn();
    render(
      <RuleChangesDialog
        changes={[{ version: 8, changes: ["No stack bonus.", "No rack bonus."] }]}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("No stack bonus.")).toBeTruthy();
    expect(screen.getByText("No rack bonus.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

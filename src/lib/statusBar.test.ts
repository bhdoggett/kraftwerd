import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { syncStatusBar } from "./statusBar";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: vi.fn() },
}));
const statusBar = vi.hoisted(() => ({ hide: vi.fn(), show: vi.fn() }));
vi.mock("@capacitor/status-bar", () => ({ StatusBar: statusBar }));

function onPlatform(platform: string) {
  vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
}

describe("syncStatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusBar.hide.mockResolvedValue(undefined);
    statusBar.show.mockResolvedValue(undefined);
  });

  test("hides the bar on Android held sideways", async () => {
    onPlatform("android");
    await syncStatusBar(true);
    expect(statusBar.hide).toHaveBeenCalledTimes(1);
  });

  test("shows it again when Android turns upright", async () => {
    onPlatform("android");
    await syncStatusBar(false);
    expect(statusBar.show).toHaveBeenCalledTimes(1);
  });

  test("leaves iOS alone", async () => {
    onPlatform("ios");
    await syncStatusBar(true);
    await syncStatusBar(false);
    expect(statusBar.hide).not.toHaveBeenCalled();
    expect(statusBar.show).not.toHaveBeenCalled();
  });

  test("does nothing on the web", async () => {
    onPlatform("web");
    await syncStatusBar(true);
    await syncStatusBar(false);
    expect(statusBar.hide).not.toHaveBeenCalled();
    expect(statusBar.show).not.toHaveBeenCalled();
  });

  test("a plugin failure does not throw", async () => {
    onPlatform("android");
    statusBar.hide.mockRejectedValue(new Error("no plugin"));
    await expect(syncStatusBar(true)).resolves.toBeUndefined();
  });
});

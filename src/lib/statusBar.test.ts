import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { syncStatusBar } from "./statusBar";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: vi.fn() },
}));
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: { hide: vi.fn(), show: vi.fn() },
}));

function onPlatform(platform: string) {
  vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
}

describe("syncStatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(StatusBar.hide).mockResolvedValue();
    vi.mocked(StatusBar.show).mockResolvedValue();
  });

  test("hides the bar on Android held sideways", async () => {
    onPlatform("android");
    await syncStatusBar(true);
    expect(StatusBar.hide).toHaveBeenCalledTimes(1);
  });

  test("shows it again when Android turns upright", async () => {
    onPlatform("android");
    await syncStatusBar(false);
    expect(StatusBar.show).toHaveBeenCalledTimes(1);
  });

  test("leaves iOS alone", async () => {
    onPlatform("ios");
    await syncStatusBar(true);
    await syncStatusBar(false);
    expect(StatusBar.hide).not.toHaveBeenCalled();
    expect(StatusBar.show).not.toHaveBeenCalled();
  });

  test("does nothing on the web", async () => {
    onPlatform("web");
    await syncStatusBar(true);
    await syncStatusBar(false);
    expect(StatusBar.hide).not.toHaveBeenCalled();
    expect(StatusBar.show).not.toHaveBeenCalled();
  });

  test("a plugin failure does not throw", async () => {
    onPlatform("android");
    vi.mocked(StatusBar.hide).mockRejectedValue(new Error("no plugin"));
    await expect(syncStatusBar(true)).resolves.toBeUndefined();
  });
});

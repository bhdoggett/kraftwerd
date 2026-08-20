import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const hook = join(dirname(fileURLToPath(import.meta.url)), "contributor-mode.mjs");

// Neutralise global/system git config so a repo with no local user.email set
// truly resolves to "no email configured", instead of falling back to
// whatever `git config user.email` finds in the global config on this
// machine (the owner's own address).
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function runFor(email) {
  const repo = mkdtempSync(join(tmpdir(), "session-"));
  execFileSync("git", ["-C", repo, "init", "-b", "main"], { stdio: "pipe", env: GIT_ENV });
  if (email) {
    execFileSync("git", ["-C", repo, "config", "user.email", email], { stdio: "pipe", env: GIT_ENV });
  }
  const payload = JSON.stringify({ hook_event_name: "SessionStart", cwd: repo });
  const stdout = execFileSync("node", [hook], { input: payload, encoding: "utf8", env: GIT_ENV });
  return stdout.trim() === "" ? null : JSON.parse(stdout);
}

describe("contributor-mode hook", () => {
  test("tells a contributor's agent to load the skill", () => {
    const result = runFor("brother@example.com");
    expect(result.additionalContext).toMatch(/contributing/);
    expect(result.additionalContext).toMatch(/branch/i);
  });

  test("stays silent for the owner", () => {
    expect(runFor("bdoggett@gmail.com")).toBeNull();
  });

  test("treats an unset email as a contributor", () => {
    expect(runFor(null)?.additionalContext).toMatch(/contributing/);
  });
});

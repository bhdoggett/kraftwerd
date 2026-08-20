import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const hook = join(dirname(fileURLToPath(import.meta.url)), "guardrails.mjs");

// Neutralise global/system git config so a repo with no local user.email set
// truly resolves to "no email configured", instead of falling back to
// whatever `git config user.email` finds in the global config on this
// machine (the owner's own address).
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function makeRepo(email) {
  const repo = mkdtempSync(join(tmpdir(), "entry-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe", env: GIT_ENV });
  git("init", "-b", "main");
  git("config", "user.email", email);
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-m", "first");
  return repo;
}

function run(repo, command) {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    cwd: repo,
    tool_input: { command },
  });
  const stdout = execFileSync("node", [hook], { input: payload, encoding: "utf8", env: GIT_ENV });
  return stdout.trim() === "" ? null : JSON.parse(stdout);
}

describe("guardrails hook entry", () => {
  test("denies a contributor pushing to main", () => {
    const result = run(makeRepo("brother@example.com"), "git push origin main");
    expect(result.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.permissionDecisionReason).toMatch(/main branch/i);
  });

  test("denies a contributor committing on main", () => {
    const result = run(makeRepo("brother@example.com"), "git commit -m 'work'");
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("says nothing about ordinary contributor commands", () => {
    expect(run(makeRepo("brother@example.com"), "npm run dev")).toBeNull();
  });

  test("says nothing at all when the owner is driving", () => {
    expect(run(makeRepo("bdoggett@gmail.com"), "git push origin main")).toBeNull();
    expect(run(makeRepo("bdoggett@gmail.com"), "npx convex deploy")).toBeNull();
  });

  test("guards a contributor whose email is not configured", () => {
    const repo = mkdtempSync(join(tmpdir(), "entry-noemail-"));
    execFileSync("git", ["-C", repo, "init", "-b", "main"], { stdio: "pipe", env: GIT_ENV });
    const result = run(repo, "npx convex deploy");
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("stays quiet on malformed input rather than crashing", () => {
    const stdout = execFileSync("node", [hook], { input: "not json", encoding: "utf8", env: GIT_ENV });
    expect(stdout.trim()).toBe("");
  });
});

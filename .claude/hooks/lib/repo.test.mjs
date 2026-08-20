import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { currentBranch, currentEmail } from "./repo.mjs";

let repo;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "guardrails-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "brother@example.com");
  git("config", "user.name", "Brother");
  git("commit", "--allow-empty", "-m", "first");
});

describe("repo helpers", () => {
  test("reads the configured email", () => {
    expect(currentEmail(repo)).toBe("brother@example.com");
  });

  test("reads the current branch", () => {
    expect(currentBranch(repo)).toBe("main");
  });

  test("returns null outside a git repo instead of throwing", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    expect(currentBranch(notARepo)).toBeNull();
  });
});

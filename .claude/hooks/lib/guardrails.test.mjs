import { describe, expect, test } from "vitest";
import { evaluateCommand, isOwner, OWNER_EMAIL } from "./guardrails.mjs";

describe("isOwner", () => {
  test("recognises the owner", () => {
    expect(isOwner(OWNER_EMAIL)).toBe(true);
  });

  test("ignores surrounding whitespace and case", () => {
    expect(isOwner("  BDoggett@Gmail.com \n")).toBe(true);
  });

  test("treats anyone else as a contributor", () => {
    expect(isOwner("brother@example.com")).toBe(false);
  });

  test("treats an unset email as a contributor", () => {
    expect(isOwner(null)).toBe(false);
    expect(isOwner("")).toBe(false);
    expect(isOwner(undefined)).toBe(false);
  });
});

describe("evaluateCommand", () => {
  test("allows ordinary work", () => {
    expect(evaluateCommand("npm run dev")).toBeNull();
    expect(evaluateCommand("git status")).toBeNull();
    expect(evaluateCommand("git push -u origin ben/tile-colours")).toBeNull();
    expect(evaluateCommand("git branch -d ben/old-work")).toBeNull();
    expect(evaluateCommand("npx convex dev")).toBeNull();
    expect(evaluateCommand("npx convex env set SITE_URL http://localhost:5175")).toBeNull();
  });

  test("blocks pushing to main, however it is spelled", () => {
    for (const command of [
      "git push origin main",
      "git push  origin   main",
      "git push origin HEAD:main",
      "npm test && git push origin main",
    ]) {
      expect(evaluateCommand(command)?.id).toBe("push-to-main");
    }
  });

  test("blocks force pushes", () => {
    for (const command of [
      "git push --force origin ben/work",
      "git push --force-with-lease",
      "git push -f origin ben/work",
      "git push origin +ben/work",
    ]) {
      expect(evaluateCommand(command)?.id).toBe("force-push");
    }
  });

  test("blocks history rewrites and hard resets", () => {
    expect(evaluateCommand("git reset --hard HEAD~1")?.id).toBe("reset-hard");
    expect(evaluateCommand("git rebase origin/main")?.id).toBe("rebase");
    expect(evaluateCommand("git branch -D ben/work")?.id).toBe("force-delete-branch");
  });

  test("blocks the long-form spelling of a force branch delete", () => {
    expect(evaluateCommand("git branch --delete --force ben/work")?.id).toBe(
      "force-delete-branch",
    );
    expect(evaluateCommand("git branch --delete ben/work")).toBeNull();
  });

  test("blocks a bare push while sitting on main, but not elsewhere", () => {
    expect(evaluateCommand("git push", { branch: "main" })?.id).toBe("push-to-main");
    expect(evaluateCommand("git push", { branch: "ben/work" })).toBeNull();
    expect(evaluateCommand("git push origin main", { branch: "ben/work" })?.id).toBe(
      "push-to-main",
    );
    expect(evaluateCommand("git push -u origin ben/work", { branch: "main" })).toBeNull();
  });

  test("blocks merging and deleting through the GitHub CLI", () => {
    expect(evaluateCommand("gh pr merge 4 --squash")?.id).toBe("pr-merge");
    expect(evaluateCommand("gh api repos/x/y/rulesets/1 -X DELETE")?.id).toBe("gh-delete");
  });

  test("blocks anything that reaches production", () => {
    expect(evaluateCommand("npx convex deploy")?.id).toBe("convex-deploy");
    expect(evaluateCommand("npx convex env set --prod SITE_URL x")?.id).toBe("prod-flag");
    expect(evaluateCommand("npx convex import --prod --table words f.jsonl")?.id).toBe("prod-flag");
  });

  test("blocks committing while on main, and only while on main", () => {
    expect(evaluateCommand("git commit -m 'x'", { branch: "main" })?.id).toBe("commit-on-main");
    expect(evaluateCommand("git commit -m 'x'", { branch: "ben/work" })).toBeNull();
    expect(evaluateCommand("git commit -m 'x'")).toBeNull();
  });

  test("every reason says what to do instead", () => {
    const denied = evaluateCommand("git push origin main");
    expect(denied.reason.length).toBeGreaterThan(40);
    expect(denied.reason).toMatch(/instead/i);
  });
});

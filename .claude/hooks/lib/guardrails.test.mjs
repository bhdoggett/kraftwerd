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

  test("blocks a push naming only the remote while sitting on main", () => {
    expect(evaluateCommand("git push origin", { branch: "main" })?.id).toBe("push-to-main");
    expect(evaluateCommand("git push origin ben/work", { branch: "main" })).toBeNull();
    expect(evaluateCommand("git push origin HEAD:ben/work", { branch: "main" })).toBeNull();
    expect(evaluateCommand("git push origin", { branch: "ben/work" })).toBeNull();
  });

  test("blocks clustered short flags on a force branch delete", () => {
    expect(evaluateCommand("git branch -Df ben/work")?.id).toBe("force-delete-branch");
    expect(evaluateCommand("git branch -fd ben/work")?.id).toBe("force-delete-branch");
    expect(evaluateCommand("git branch -d ben/work")).toBeNull();
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

  test("allows the documented happy path as one multi-line block", () => {
    const block = [
      "git push -u origin ben/tile-colours",
      'gh pr create --draft --base main --title "x" --body "y"',
    ].join("\n");
    expect(evaluateCommand(block)).toBeNull();
    expect(evaluateCommand(block, { branch: "ben/tile-colours" })).toBeNull();
  });

  test("does not treat 'main' inside a branch name as a push to main", () => {
    expect(evaluateCommand("git push -u origin sam/fix-main-menu")).toBeNull();
    expect(
      evaluateCommand("git push -u origin sam/fix-main-menu", { branch: "sam/fix-main-menu" }),
    ).toBeNull();
  });

  test("still blocks push-to-main spelled with refs/heads", () => {
    expect(evaluateCommand("git push origin refs/heads/main")?.id).toBe("push-to-main");
  });

  test("recognises git verbs behind a -C or -c prefix", () => {
    expect(evaluateCommand("git -C /some/path push origin main")?.id).toBe("push-to-main");
    expect(evaluateCommand("git -c core.pager=cat push origin main")?.id).toBe("push-to-main");
  });

  test("blocks clustered short flags on a force push", () => {
    expect(evaluateCommand("git push -uf origin ben/work")?.id).toBe("force-push");
  });

  test("blocks git pull --rebase and git pull -r as rebases", () => {
    expect(evaluateCommand("git pull --rebase")?.id).toBe("rebase");
    expect(evaluateCommand("git pull --rebase origin main")?.id).toBe("rebase");
    expect(evaluateCommand("git pull -r")?.id).toBe("rebase");
  });

  test("blocks a bare pull on main, but not elsewhere", () => {
    expect(evaluateCommand("git pull", { branch: "main" })?.id).toBe("pull-on-main");
    expect(evaluateCommand("git pull origin main", { branch: "main" })?.id).toBe("pull-on-main");
    expect(evaluateCommand("git pull", { branch: "ben/work" })).toBeNull();
    expect(evaluateCommand("git pull")).toBeNull();
  });

  test("blocks writing the git identity but allows reading it", () => {
    expect(evaluateCommand("git config user.email bdoggett@gmail.com")?.id).toBe("set-identity");
    expect(evaluateCommand("git config --global user.name Ben")?.id).toBe("set-identity");
    expect(evaluateCommand("git -c user.email=bdoggett@gmail.com commit -m x")?.id).toBe(
      "set-identity",
    );
    expect(evaluateCommand("git config user.email")).toBeNull();
    expect(evaluateCommand("git config --get user.email")).toBeNull();
  });

  test("blocks merging a pull request through the GitHub API, not just gh pr merge", () => {
    expect(evaluateCommand("gh api -X PUT repos/o/r/pulls/1/merge")?.id).toBe("pr-merge");
    expect(evaluateCommand("gh api --method PUT repos/o/r/pulls/1/merge")?.id).toBe("pr-merge");
  });

  test("blocks commands that discard uncommitted work", () => {
    expect(evaluateCommand("git clean -fdx")?.id).toBe("discard-work");
    expect(evaluateCommand("git checkout -- .")?.id).toBe("discard-work");
    expect(evaluateCommand("git restore --staged --worktree .")?.id).toBe("discard-work");
    expect(evaluateCommand("git restore --staged file.txt")).toBeNull();
  });

  test("blocks convex commands that name an explicit deployment target", () => {
    expect(evaluateCommand("npx convex env list --url https://x.convex.cloud")?.id).toBe(
      "prod-flag",
    );
    expect(evaluateCommand("npx convex dev --once --deployment-name happy-otter-1")?.id).toBe(
      "prod-flag",
    );
  });

  test("blocks a dangerous push even when it is not the first push in the command", () => {
    for (const command of [
      "git push origin sam/topic && git push origin main",
      "git push origin ben/x\ngit push origin main",
      "git push origin ben/x; git push origin main",
    ]) {
      expect(evaluateCommand(command, { branch: "ben/x" })?.id).toBe("push-to-main");
    }
    expect(
      evaluateCommand("git push origin ben/x && git push -f origin ben/x", { branch: "ben/x" })
        ?.id,
    ).toBe("force-push");
  });

  test("blocks a dangerous clean even when it is not the first clean in the command", () => {
    expect(evaluateCommand("git clean -n && git clean -fdx")?.id).toBe("discard-work");
  });

  test("still allows innocent commands with multiple pushes/cleans, none of them dangerous", () => {
    expect(
      evaluateCommand("git push origin sam/topic && git push origin sam/topic2", {
        branch: "ben/x",
      }),
    ).toBeNull();
    expect(evaluateCommand("git clean -n && git clean -ndx")).toBeNull();
  });

  test("catches quoted and partially-qualified spellings of main", () => {
    for (const command of ['git push origin "main"', "git push origin 'main'", "git push origin heads/main"]) {
      expect(evaluateCommand(command)?.id).toBe("push-to-main");
    }
  });

  test("quote-stripping does not reintroduce the branch-name false positive", () => {
    expect(evaluateCommand("git push -u origin sam/fix-main-menu")).toBeNull();
    const block = [
      "git push -u origin ben/tile-colours",
      'gh pr create --draft --base main --title "x" --body "y"',
    ].join("\n");
    expect(evaluateCommand(block)).toBeNull();
  });

  test("blocks a dangerous branch delete even when it is not the first branch call", () => {
    expect(evaluateCommand("git branch -d ben/a && git branch -D ben/b")?.id).toBe(
      "force-delete-branch",
    );
  });

  test("preserves safe branch deletes as the negative control", () => {
    expect(evaluateCommand("git branch -d ben/old-work")).toBeNull();
    expect(evaluateCommand("git branch --delete ben/old-work")).toBeNull();
  });

  test("blocks a dangerous pull --rebase even when it is not the first pull call", () => {
    expect(evaluateCommand("git pull origin && git pull --rebase")?.id).toBe("rebase");
  });

  test("preserves a plain pull off main as the negative control", () => {
    expect(evaluateCommand("git pull", { branch: "ben/work" })).toBeNull();
    expect(evaluateCommand("git pull")).toBeNull();
  });

  test("blocks a config write even when preceded by an innocent read", () => {
    expect(
      evaluateCommand("git config user.email && git config user.email x@y.com")?.id,
    ).toBe("set-identity");
  });

  test("preserves a bare config read as the negative control", () => {
    expect(evaluateCommand("git config user.email")).toBeNull();
    expect(evaluateCommand("git config --get user.email")).toBeNull();
  });

  test("blocks commands prefixed with a production env var assignment", () => {
    expect(evaluateCommand("CONVEX_DEPLOY_KEY=prod:abc npx convex env list")?.id).toBe(
      "prod-flag",
    );
    expect(evaluateCommand("CONVEX_DEPLOYMENT=happy-otter-1 npx convex data words")?.id).toBe(
      "prod-flag",
    );
  });
});

# Contributor Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-coding contributor work on this repo from his own machine — branch-first, always synced with `main`, unable to reach production or destroy work — with everything he needs arriving in his first clone.

**Architecture:** Three redundant layers. A `SessionStart` hook detects contributor mode from `git config user.email` and injects an instruction to load the skill. A `PreToolUse` hook hard-denies destructive and production-reaching Bash commands. A committed `contributing` skill teaches the branch → commit → push → draft-PR workflow in plain English. Above all three, a GitHub ruleset on `main` enforces PR-only merges server-side, where no local bypass reaches.

**Tech Stack:** Node 24 (pinned in `.nvmrc`), ESM `.mjs` hook scripts, vitest, `gh` CLI, Convex, Better Auth.

**Spec:** `docs/superpowers/specs/2026-08-19-contributor-workflow-design.md`

## Global Constraints

- **Owner email is `bdoggett@gmail.com`** — the single source of truth for owner mode. Defined once, in `.claude/hooks/lib/guardrails.mjs`, imported everywhere else. Never re-typed as a literal in another file.
- **Unknown or unset email resolves to contributor mode.** Never the reverse.
- **Hooks are `.mjs`, not `.ts`.** This deviates from the project's TypeScript-always rule, deliberately. Hooks run under whatever `node` is on the contributor's `PATH` at session start, not the `.nvmrc` version. A `.ts` hook depends on Node's type-stripping (Node ≥22.18); on an older Node it throws, the harness treats that as a non-blocking error, and **the blocked command proceeds anyway**. A guardrail that fails open is worse than no guardrail. `.mjs` runs on every Node ≥18.
- **Hooks must never throw.** Every entry script wraps its body in `try/catch`. On any internal error, emit no decision and exit 0 — except where the plan says otherwise.
- **Plain English in everything a contributor reads.** No git vocabulary in user-facing sentences. "Saved your work and sent it to GitHub", never "committed and pushed". Every denial reason states what was blocked, why, and what to do instead.
- **Node 24**, pinned via `.nvmrc` and `engines.node >= 22.12`.
- **Vite dev port is `5175`**, pinned in `vite.config.ts:37` so a collision fails loudly instead of silently breaking the OAuth callback. `SITE_URL` must match it.
- Out of scope, do not touch: `docs/auth-setup.md:52` says `5173` and is stale. Separate fix.

## File Structure

| File | Responsibility |
|---|---|
| `.claude/hooks/lib/guardrails.mjs` | Pure decision logic. Owner check, deny rules, reasons. No I/O. |
| `.claude/hooks/lib/guardrails.test.mjs` | Unit tests for the above. |
| `.claude/hooks/lib/repo.mjs` | Thin git wrappers: current email, current branch. The only I/O the logic needs. |
| `.claude/hooks/guardrails.mjs` | PreToolUse entry. stdin JSON → decision JSON. |
| `.claude/hooks/guardrails.entry.test.mjs` | End-to-end test: spawns the entry against a throwaway git repo. |
| `.claude/hooks/contributor-mode.mjs` | SessionStart entry. Injects contributor context, or stays silent. |
| `.claude/hooks/contributor-mode.test.mjs` | End-to-end test for the above. |
| `.claude/settings.json` | Registers both hooks. New file. |
| `.claude/skills/contributing/SKILL.md` | The workflow, short enough to read every session. |
| `.claude/skills/contributing/references/first-time-setup.md` | Clone → running app. |
| `.claude/skills/contributing/references/git-workflow.md` | Branch, commit, push, sync, draft PR. |
| `.claude/skills/contributing/references/convex-local.md` | His dev deployment, env vars, seeding. |
| `.claude/skills/contributing/references/troubleshooting.md` | Failures that don't look like failures. |
| `.gitignore` | Carve-out so the above ships in a clone. Modify. |
| `CLAUDE.md`, `AGENTS.md` | Point agents at the skill. Modify. |
| `docs/onboarding-a-contributor.md` | The owner-side checklist. Not for the contributor. |
| `vitest.config.ts` | Third project for hook tests. Modify. |

---

### Task 1: Guardrail decision logic

The pure core: given a command string and the current branch, decide allow or deny. No file I/O, no git calls, no process access — which is exactly what makes it testable.

**Files:**
- Modify: `.gitignore:37` (the bare `.claude/` line)
- Create: `.claude/hooks/lib/guardrails.mjs`
- Test: `.claude/hooks/lib/guardrails.test.mjs`
- Modify: `vitest.config.ts:6-24` (add a third project)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `OWNER_EMAIL: string`
  - `isOwner(email: string | null | undefined): boolean`
  - `evaluateCommand(command: string, context?: { branch?: string | null }): { id: string, reason: string } | null` — `null` means no objection.

- [ ] **Step 1: Carve the contributor files out of `.gitignore`**

Nothing in this plan can be committed until this is done — `.claude/` is
currently ignored wholesale. Replace the single `.claude/` line in `.gitignore`
with:

```
# Only the hand-written contributor tooling is tracked. The vendored convex
# skills are generated from the tracked skills-lock.json by
# `npx convex ai-files install`, so committing them would only add merge
# conflicts on every update.
.claude/*
!.claude/hooks/
!.claude/settings.json
!.claude/skills/
.claude/skills/*
!.claude/skills/contributing/
```

Leave `.agents/`, `.cursor/`, and `.fallow/` exactly as they are. Verify:

```bash
git check-ignore -v .claude/hooks || echo "TRACKABLE: hooks"
git check-ignore -v .claude/skills/convex/SKILL.md && echo "IGNORED: vendored skills (correct)"
```

Expected: `TRACKABLE: hooks` and `IGNORED: vendored skills (correct)`. Order
matters — a later negation re-includes what an earlier line excluded.

- [ ] **Step 2: Add the hooks test project to vitest**

Modify `vitest.config.ts`, adding a third entry to `projects`:

```ts
      {
        test: {
          name: "hooks",
          environment: "node",
          include: [".claude/hooks/**/*.test.mjs"],
        },
      },
```

- [ ] **Step 3: Write the failing tests**

Create `.claude/hooks/lib/guardrails.test.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run --project hooks`

Expected: FAIL — `Failed to resolve import "./guardrails.mjs"`.

**If instead it reports "No test files found"**, vitest's globbing skipped the dot-directory. Fall back to Node's built-in runner: drop the `hooks` project from `vitest.config.ts`, add `"test:hooks": "node --test .claude/hooks/**/*.test.mjs"` to `package.json` scripts, and replace the vitest import in every hook test with `import { describe, test } from "node:test"; import { expect } from "node:assert"` style — `node:assert`'s `deepStrictEqual`/`strictEqual` in place of `expect`. Record the switch in the commit message so later tasks follow suit.

- [ ] **Step 5: Write the implementation**

Create `.claude/hooks/lib/guardrails.mjs`:

```js
/**
 * Pure decision logic for the contributor guardrails.
 *
 * No I/O lives here on purpose: everything in this file is a function of its
 * arguments, so the whole ruleset is unit-testable without a git repo, a
 * filesystem, or a running session.
 */

export const OWNER_EMAIL = "bdoggett@gmail.com";

/**
 * Identification, not authentication. This stops accidents; the GitHub
 * ruleset on `main` is what stops everything else. An unknown or unset email
 * resolves to contributor mode — the safe side.
 */
export function isOwner(email) {
  return typeof email === "string" && email.trim().toLowerCase() === OWNER_EMAIL;
}

/**
 * Rules are scanned against the whole command string rather than a parsed
 * argv, so `npm test && git push origin main` is caught as readily as the
 * bare push. False positives are acceptable here; a missed force-push is not.
 */
const RULES = [
  {
    id: "push-to-main",
    matches: (command) => /git\s+push\b[^&|;]*\bmain\b/.test(command),
    reason:
      "That would send code straight to the main branch, which is the version everyone else uses. " +
      "Work always goes onto its own branch first. Instead: push to the branch you are working on, " +
      "then open a draft pull request so Ben can look it over.",
  },
  {
    id: "force-push",
    matches: (command) =>
      /git\s+push\b[^&|;]*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S)/.test(command),
    reason:
      "A force push overwrites history on GitHub and can erase work that is already saved there. " +
      "Instead: make a normal push. If it is rejected because the branch moved, bring in the latest " +
      "changes with `git merge origin/main` and push again.",
  },
  {
    id: "reset-hard",
    matches: (command) => /git\s+reset\b[^&|;]*--hard\b/.test(command),
    reason:
      "This throws away uncommitted work permanently, with no undo. " +
      "Instead: save the work on the current branch, or say what should be undone and it can be " +
      "reversed with a new commit that keeps the history intact.",
  },
  {
    id: "rebase",
    matches: (command) => /git\s+rebase\b/.test(command),
    reason:
      "Rebasing rewrites history, and recovering from a bad one needs a force push, which is also blocked. " +
      "Instead: use `git merge origin/main` to bring in the latest changes. It is additive and never " +
      "destroys work.",
  },
  {
    id: "force-delete-branch",
    matches: (command) => /git\s+branch\b[^&|;]*\s-D\b/.test(command),
    reason:
      "Capital -D deletes a branch even when it holds work that was never sent to GitHub. " +
      "Instead: use `git branch -d`, which refuses to delete anything that would be lost.",
  },
  {
    id: "pr-merge",
    matches: (command) => /gh\s+pr\s+merge\b/.test(command),
    reason:
      "Only Ben merges pull requests. Instead: push the branch and leave the draft pull request open — " +
      "he gets an email and can review it whenever he likes.",
  },
  {
    id: "gh-delete",
    matches: (command) => /gh\s+api\b[^&|;]*(-X|--method)\s+DELETE\b/.test(command),
    reason:
      "This deletes something on GitHub itself — a branch, a rule, or a pull request. " +
      "Instead: ask Ben, who can do it from the GitHub website in a few seconds.",
  },
  {
    id: "convex-deploy",
    matches: (command) => /convex\s+deploy\b/.test(command),
    reason:
      "This publishes to the live app that real people are using. " +
      "Instead: `npm run dev` runs your own private copy of the backend, which is where all your " +
      "testing should happen.",
  },
  {
    id: "prod-flag",
    matches: (command) => /--prod\b/.test(command),
    reason:
      "The --prod flag points at the live app that real people are using. " +
      "Instead: run the same command without --prod and it targets your own private copy.",
  },
  {
    id: "commit-on-main",
    matches: (command, context) =>
      context?.branch === "main" && /git\s+commit\b/.test(command),
    reason:
      "You are on the main branch, which is the shared version of the app. " +
      "Instead: start a branch for this piece of work first, then save onto it. " +
      "`git checkout -b <your-name>/<what-you-are-doing> origin/main` does it.",
  },
];

/**
 * @returns the first matching rule as `{ id, reason }`, or null if nothing objects.
 */
export function evaluateCommand(command, context = {}) {
  if (typeof command !== "string" || command.length === 0) return null;
  for (const rule of RULES) {
    if (rule.matches(command, context)) return { id: rule.id, reason: rule.reason };
  }
  return null;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run --project hooks`

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add .gitignore vitest.config.ts .claude/hooks/lib/guardrails.mjs .claude/hooks/lib/guardrails.test.mjs
git commit -m "feat(hooks): add contributor guardrail decision logic"
```

---

### Task 2: Git state helpers

The only I/O the hooks need: who is this, and what branch are they on.

**Files:**
- Create: `.claude/hooks/lib/repo.mjs`
- Test: `.claude/hooks/lib/repo.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `currentEmail(cwd: string): string | null`
  - `currentBranch(cwd: string): string | null`

Both take an explicit `cwd` rather than reading `process.cwd()` — the hook payload carries the session's `cwd`, and an explicit argument is what makes these testable against a throwaway repo.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/lib/repo.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project hooks .claude/hooks/lib/repo.test.mjs`

Expected: FAIL — cannot resolve `./repo.mjs`.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/lib/repo.mjs`:

```js
import { execFileSync } from "node:child_process";

/**
 * Git reads for the hooks. Every call returns null rather than throwing:
 * a hook that crashes is a hook that silently stops guarding.
 */
function git(cwd, args) {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function currentEmail(cwd) {
  return git(cwd, ["config", "user.email"]);
}

export function currentBranch(cwd) {
  return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run --project hooks`

Expected: PASS — all tests from Tasks 1 and 2.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/repo.mjs .claude/hooks/lib/repo.test.mjs
git commit -m "feat(hooks): read git email and branch for guardrail context"
```

---

### Task 3: PreToolUse hook entry

Wires the logic to the harness: read the hook payload on stdin, emit a deny decision on stdout.

**Files:**
- Create: `.claude/hooks/guardrails.mjs`
- Test: `.claude/hooks/guardrails.entry.test.mjs`

**Interfaces:**
- Consumes: `evaluateCommand`, `isOwner` from `./lib/guardrails.mjs`; `currentEmail`, `currentBranch` from `./lib/repo.mjs`.
- Produces: an executable script. Input on stdin is the PreToolUse payload:
  `{ hook_event_name: "PreToolUse", tool_name: string, cwd: string, tool_input: { command?: string } }`.
  Output on stdout, only when denying:
  `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: string } }`.
  Silence plus exit 0 means "no opinion" and the normal permission flow continues.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/guardrails.entry.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const hook = join(dirname(fileURLToPath(import.meta.url)), "guardrails.mjs");

function makeRepo(email) {
  const repo = mkdtempSync(join(tmpdir(), "entry-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
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
  const stdout = execFileSync("node", [hook], { input: payload, encoding: "utf8" });
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
    execFileSync("git", ["-C", repo, "init", "-b", "main"], { stdio: "pipe" });
    const result = run(repo, "npx convex deploy");
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("stays quiet on malformed input rather than crashing", () => {
    const stdout = execFileSync("node", [hook], { input: "not json", encoding: "utf8" });
    expect(stdout.trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project hooks .claude/hooks/guardrails.entry.test.mjs`

Expected: FAIL — `Cannot find module .../guardrails.mjs`.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/guardrails.mjs`:

```js
#!/usr/bin/env node
/**
 * PreToolUse hook. Blocks the commands a non-coding contributor should never
 * run, with a reason that says what to do instead.
 *
 * Silence means "no opinion" — the normal permission flow continues. The
 * script never throws: an unhandled error would be treated as a non-blocking
 * failure and the command would run anyway, so every path ends in exit 0.
 */
import { evaluateCommand, isOwner } from "./lib/guardrails.mjs";
import { currentBranch, currentEmail } from "./lib/repo.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

try {
  const payload = JSON.parse(await readStdin());
  const command = payload?.tool_input?.command;
  const cwd = payload?.cwd ?? process.cwd();

  if (typeof command === "string" && !isOwner(currentEmail(cwd))) {
    const verdict = evaluateCommand(command, { branch: currentBranch(cwd) });
    if (verdict) deny(verdict.reason);
  }
} catch {
  // Deliberately silent. See the note above.
}

process.exit(0);
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run --project hooks`

Expected: PASS — all tests from Tasks 1 through 3.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/guardrails.mjs .claude/hooks/guardrails.entry.test.mjs
git commit -m "feat(hooks): block destructive and production commands for contributors"
```

---

### Task 4: Session-start hook

Announces contributor mode before the agent does anything else, so the workflow is loaded rather than discovered by hitting a denial.

**Files:**
- Create: `.claude/hooks/contributor-mode.mjs`
- Test: `.claude/hooks/contributor-mode.test.mjs`

**Interfaces:**
- Consumes: `isOwner` from `./lib/guardrails.mjs`; `currentEmail` from `./lib/repo.mjs`.
- Produces: an executable script. Input on stdin: `{ hook_event_name: "SessionStart", cwd: string }`. Output when in contributor mode: `{ additionalContext: string, systemMessage: string }`. Silence otherwise.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/contributor-mode.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const hook = join(dirname(fileURLToPath(import.meta.url)), "contributor-mode.mjs");

function runFor(email) {
  const repo = mkdtempSync(join(tmpdir(), "session-"));
  execFileSync("git", ["-C", repo, "init", "-b", "main"], { stdio: "pipe" });
  if (email) {
    execFileSync("git", ["-C", repo, "config", "user.email", email], { stdio: "pipe" });
  }
  const payload = JSON.stringify({ hook_event_name: "SessionStart", cwd: repo });
  const stdout = execFileSync("node", [hook], { input: payload, encoding: "utf8" });
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project hooks .claude/hooks/contributor-mode.test.mjs`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/contributor-mode.mjs`:

```js
#!/usr/bin/env node
/**
 * SessionStart hook. In contributor mode it injects an instruction to load
 * the `contributing` skill; for the owner it does nothing at all.
 *
 * This duplicates the pointer in CLAUDE.md on purpose. CLAUDE.md always
 * loads but is only a suggestion; the hook is emphatic but can be declined at
 * the trust prompt. Between them, one always lands.
 */
import { isOwner } from "./lib/guardrails.mjs";
import { currentEmail } from "./lib/repo.mjs";

const CONTEXT = [
  "CONTRIBUTOR MODE is active in this repository: the configured git email is not the owner's.",
  "",
  "Before writing, editing, committing, or pushing anything, load the `contributing` skill and follow it.",
  "The short version, which the skill expands:",
  "- Never commit on `main` and never push to `main`. Work goes on a branch, always.",
  "- If a request would change code while on `main`, fetch first, branch off `origin/main`,",
  "  push the branch immediately, and open a DRAFT pull request before doing the work.",
  "- Fetch and merge `origin/main` before every push, so the branch stays current.",
  "- Never show the contributor git jargon. Explain what changed and why, in plain English.",
  "- Some commands are blocked by a hook. A denial explains what to do instead — follow it,",
  "  do not look for a way around it.",
].join("\n");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const payload = JSON.parse(await readStdin());
  const cwd = payload?.cwd ?? process.cwd();

  if (!isOwner(currentEmail(cwd))) {
    process.stdout.write(
      JSON.stringify({
        additionalContext: CONTEXT,
        systemMessage: "Contributor mode: branch-only workflow and command guardrails are active.",
      }),
    );
  }
} catch {
  // Silent by design: a broken session hook must not break the session.
}

process.exit(0);
```

- [ ] **Step 4: Run the whole hooks suite**

Run: `npx vitest run --project hooks`

Expected: PASS — every test from Tasks 1 through 4.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/contributor-mode.mjs .claude/hooks/contributor-mode.test.mjs
git commit -m "feat(hooks): announce contributor mode at session start"
```

---

### Task 5: Register the hooks

**Files:**
- Create: `.claude/settings.json`

**Interfaces:**
- Consumes: both hook entries from Tasks 3 and 4.
- Produces: nothing importable. This is the file that makes the hooks actually run.

- [ ] **Step 1: Write the settings file**

Create `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/contributor-mode.mjs"],
            "timeout": 15
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/guardrails.mjs"],
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

Exec form (`command` plus `args`) rather than a shell string, so a path containing a space cannot break it.

- [ ] **Step 2: Verify it is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid')"`

Expected: `valid`.

- [ ] **Step 3: Verify the hooks fire end to end**

This needs a real session and cannot be asserted from a test. Do it by hand:

```bash
git config user.email "brother@example.com"   # borrow contributor identity
```

Start a new Claude Code session in this repo, accept the trust prompt, and confirm:
1. The session announces contributor mode.
2. Asking it to run `git push origin main` produces the denial, with the plain-English reason.
3. Then restore: `git config user.email "bdoggett@gmail.com"`, start another session, and confirm it is silent and unrestricted.

If the SessionStart context does not appear, check whether this Claude Code version expects `hookSpecificOutput.additionalContext` rather than the top-level `additionalContext` the docs describe. Emitting both keys is acceptable and forward-compatible.

**Do not skip this step.** Everything up to here is tested in isolation; this is the only check that the harness actually loads and honours the hooks.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(hooks): register contributor hooks in project settings"
```

---

### Task 6: The contributing skill

**Files:**
- Create: `.claude/skills/contributing/SKILL.md`
- Create: `.claude/skills/contributing/references/git-workflow.md`

**Interfaces:**
- Consumes: the guardrails' denial reasons — the skill's instructions must never contradict them.
- Produces: a skill named `contributing`, referenced by name in `CLAUDE.md`, `AGENTS.md`, and the SessionStart hook. The name is load-bearing; do not rename it without updating all three.

- [ ] **Step 1: Write SKILL.md**

Create `.claude/skills/contributing/SKILL.md`:

```markdown
---
name: contributing
description: Use before any work in the word-craft repo when the git email is not the owner's - establishes the branch-first workflow, plain-English narration, and what to do at the start and end of every piece of work.
---

# Contributing to word-craft

You are working with someone who does not write code and does not know git.
He describes what he wants; you do all of it. He should never be shown a
command to type, a conflict marker, or a piece of git vocabulary.

## Talk like this

- "Saved your work and sent it to GitHub." Not "committed and pushed."
- "Ben changed some of the same files. I've brought his changes in and yours still work."
- "This branch is where your new tile colours live. Ben will see it as a draft on GitHub."

Explain what changed and why. If something needs his decision, ask in terms of
the game, never in terms of git.

## Every session starts the same way

1. `git fetch origin`
2. Say where things stand: "main has 3 new commits since your branch started" or
   "you're up to date."
3. If this is his first time in this repo — no `.env.local`, or `node_modules`
   missing — read `references/first-time-setup.md` and walk him through it.

## Before writing any code

If the current branch is `main`, stop and set up a branch first. Do not edit a
single file until this is done:

1. `git fetch origin`
2. `git checkout -b <his-name>/<short-topic> origin/main`
3. `git push -u origin <branch>` — immediately, before there is anything to lose
4. `gh pr create --draft --base main --title "<plain English>" --body "<what he asked for>"`

Branch names are lowercase and hyphenated: `sam/bigger-tiles`, `sam/fix-scoring`.

The draft pull request is how Ben finds out the work exists. Open it even if
the work is one line.

## While working

- Commit each finished piece with a plain-English message.
- Push after each commit, so nothing lives only on his laptop.
- Before each push: `git fetch origin`, and if `origin/main` moved,
  `git merge origin/main` first.
- On a long session — an hour or more — fetch again before the next commit.

Full detail in `references/git-workflow.md`.

## Conflicts are yours to solve

He never sees a conflict marker. Resolve it, then say what you did in his
terms: "you and Ben both changed the tile colours; I kept your hover effect and
his border." Ask only when the choice genuinely cannot be made from context,
and ask about the game, not about the file.

## Never

- Commit or push on `main`.
- Force push, rebase, or `git reset --hard`.
- Merge a pull request.
- Run `npx convex deploy`, or any command with `--prod`.

A hook blocks these. If you see a denial, it explains what to do instead —
follow it. Do not look for another way around.

## The backend

He has his own private copy of the backend. `npm run dev` starts it. Nothing he
does can reach the live app. Setup and troubleshooting for it live in
`references/convex-local.md`.

## When something breaks

Read `references/troubleshooting.md` before guessing. The failures in this
project mostly do not look like failures — an empty dictionary makes every
valid word look wrong, rather than producing an error.
```

- [ ] **Step 2: Write the git workflow reference**

Create `.claude/skills/contributing/references/git-workflow.md`:

```markdown
# Git workflow

Everything here runs on his behalf. He types nothing.

## Local main is never touched

Never `git checkout main`. Never commit to it, never merge into it, never pull
it. `origin/main` is the reference, and `git fetch` keeps it current without
touching the working tree. This removes every "your local main has diverged"
problem before it can happen.

## Starting work

```bash
git fetch origin
git checkout -b <name>/<topic> origin/main
git push -u origin <name>/<topic>
gh pr create --draft --base main --title "..." --body "..."
```

Branch off `origin/main`, never off whatever happens to be checked out. Push
before any work exists — a branch that only lives on his laptop is a branch
that can be lost.

## Saving work

```bash
git add <specific files>
git commit -m "<plain English, present tense>"
git fetch origin
git merge origin/main      # only if origin/main moved
git push
```

Stage specific files. Never `git add -A` — it sweeps up stray files he did not
mean to share.

## Staying current

Fetch at these moments:

- session start
- before creating a branch
- before every push
- after about an hour of continuous work

If `git log HEAD..origin/main --oneline` is non-empty, `origin/main` moved.
Merge it in before pushing so the pull request stays clean.

## Merge, never rebase

`git merge origin/main` is additive: the worst case is a conflict, and it never
destroys a commit. Rebase rewrites history and needs a force push to recover
from — both are blocked, deliberately.

## Conflicts

1. Read both sides.
2. Resolve them yourself.
3. `git add <resolved files>` and commit with a message naming what you kept.
4. Tell him in plain English what the two versions were and which parts survived.

Only ask when the answer depends on what he wants the game to do — and then ask
about the game.

## Finishing

The draft pull request is already open and already has the work. Tell him it is
ready and that Ben will see it. Do not mark it ready for review, and do not
merge it — Ben does both.

## After Ben merges

```bash
git fetch origin --prune
git branch -d <name>/<topic>
```

The next piece of work starts a fresh branch from the updated `origin/main`.
`-d` refuses to delete anything unmerged; `-D`, which does not, is blocked.
```

- [ ] **Step 3: Verify the skill is discoverable and tracked**

```bash
git check-ignore -v .claude/skills/contributing/SKILL.md || echo "TRACKABLE"
head -4 .claude/skills/contributing/SKILL.md
```

Expected: `TRACKABLE`, and frontmatter whose `name:` is exactly `contributing`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/contributing/SKILL.md .claude/skills/contributing/references/git-workflow.md
git commit -m "feat(skill): add the contributing skill and git workflow reference"
```

---

### Task 7: Setup and troubleshooting references

The three documents that turn a fresh clone into a running app on his machine.

**Files:**
- Create: `.claude/skills/contributing/references/first-time-setup.md`
- Create: `.claude/skills/contributing/references/convex-local.md`
- Create: `.claude/skills/contributing/references/troubleshooting.md`

**Interfaces:**
- Consumes: the skill from Task 6 links to all three by exact filename.
- Produces: nothing importable.

- [ ] **Step 1: Write first-time-setup.md**

Create `.claude/skills/contributing/references/first-time-setup.md`:

```markdown
# First-time setup

Run these for him, one at a time, saying what each one is for. Stop at the
first failure and read `troubleshooting.md` rather than improvising.

Before starting, confirm Ben has already: added him as a collaborator on the
GitHub repo, and invited him to the Convex team. Without the second one, step 4
silently sets up a project Ben cannot see.

```bash
nvm use              # Node 24. If nvm is missing, he needs Node 24 installed.
npm install
npx convex ai-files install   # the Convex skills, pinned by skills-lock.json
```

## 4. Connect to the backend

```bash
npx convex login
npx convex dev
```

`convex dev` will ask which project to use. **Choose Ben's team, then the
existing `word-craft` project.** Do not create a new project — that is the one
mistake here that produces no error message and leaves him working somewhere
nobody else can see. If it already happened, delete the stray project from the
Convex dashboard and run `npx convex dev` again.

This gives him his own private backend. Ben has one too. They cannot affect
each other.

Stop `convex dev` once it reports it is ready.

## 5. Set up sign-in

Four settings, on his own backend. Ben supplies the last two privately; they
are the same Google credentials the project already uses.

```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:5175
npx convex env set GOOGLE_CLIENT_ID <from Ben>
npx convex env set GOOGLE_CLIENT_SECRET <from Ben>
```

Then tell him to send Ben this line, which Ben adds to the Google sign-in
settings:

```
https://<his-deployment>.convex.site/api/auth/callback/google
```

His deployment name is in `.env.local` as `CONVEX_DEPLOYMENT`. Until Ben adds
it, signing in fails with `redirect_uri_mismatch`. Everything else works.

## 6. Fill the dictionary

```bash
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

Not optional. Skipping it does not produce an error — the game loads, tiles
place, and then every word is rejected as invalid, including obvious ones.

## 7. Run it

```bash
npm run dev
```

The app opens at `http://localhost:5175`.

## 8. Check the tests still pass

```bash
npm test
```

This is how he will know later whether a change broke something.
```

- [ ] **Step 2: Write convex-local.md**

Create `.claude/skills/contributing/references/convex-local.md`:

```markdown
# His backend

Every person on this project gets their own private copy of the backend — own
database, own data, own settings. His cannot affect Ben's, and neither can
reach the live app.

`npm run dev` starts his backend and the website together. That is the only
command he needs day to day.

## What lives where

- `convex/` — backend code: the database shape, the game rules, sign-in.
- `src/` — the website: what he sees and clicks.
- `shared/` — game logic used by both.

Changes to `convex/` upload to his private backend automatically while
`npm run dev` is running.

## His settings

```bash
npx convex env list          # what is set
npx convex env set NAME value
```

Four are needed: `BETTER_AUTH_SECRET`, `SITE_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. See `first-time-setup.md`.

Never add `--prod` to any of these. `--prod` means the live app, and it is
blocked.

## The dictionary

His database starts with an empty word list, and an empty word list rejects
every word. Refill it any time with:

```bash
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

## Changing the database shape

Editing `convex/schema.ts` can fail if his existing data does not fit the new
shape. That is normal and it is safe — nothing is lost. Either adjust the
change so old data still fits, or clear the affected table from the Convex
dashboard and re-seed. Explain which one you did and why.

## What he must never run

`npx convex deploy`, or any command with `--prod`. Both reach the live app that
real people are using. Both are blocked by a hook; if you see the denial, it is
working correctly.
```

- [ ] **Step 3: Write troubleshooting.md**

Create `.claude/skills/contributing/references/troubleshooting.md`:

```markdown
# When something breaks

Check here before guessing. Most failures in this project do not look like
failures.

## Every word is rejected, even real ones

The dictionary is empty. This is the most common problem and it produces no
error.

```bash
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

## Sign-in fails with redirect_uri_mismatch

Ben has not yet added his backend's callback address to the Google settings.
Send him the `CONVEX_DEPLOYMENT` value from `.env.local` and this line:

```
https://<that-deployment>.convex.site/api/auth/callback/google
```

Nothing he can do locally fixes this.

## The sign-in button is greyed out

`GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing from his backend. Check
with `npx convex env list`. The app is designed to degrade this way rather than
crash.

## The build fails mentioning styleText

Wrong Node version. Run `nvm use` — this project needs Node 24. If `nvm` is not
installed, he needs to install Node 24 directly.

## A push is rejected

`origin/main` moved on. Bring it in and push again:

```bash
git fetch origin
git merge origin/main
git push
```

## A command was denied by a hook

Working as intended. The denial says what to do instead — do that. Do not look
for a way around it, and do not change the hook.

## The app opens on the wrong port, or sign-in breaks after restarting

The port is pinned to 5175 deliberately. If something else is already using it,
the dev server fails loudly instead of quietly moving — that is intentional,
because the sign-in flow is tied to the address. Close whatever is on 5175 and
start again.
```

- [ ] **Step 4: Verify every link the skill makes actually resolves**

```bash
ls .claude/skills/contributing/references/
grep -o "references/[a-z-]*\.md" .claude/skills/contributing/SKILL.md | sort -u
```

Expected: the four filenames listed by `ls` cover every path the second command prints. A link to a file that does not exist means the agent silently gets nothing.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/contributing/references/
git commit -m "docs(skill): add setup, backend, and troubleshooting references"
```

---

### Task 8: Point the instruction files at the skill

**Files:**
- Modify: `CLAUDE.md` (append, outside the convex markers)
- Modify: `AGENTS.md` (append, outside the convex markers)

**Interfaces:**
- Consumes: the skill name `contributing` from Task 6.
- Produces: nothing importable.

- [ ] **Step 1: Append the block to both files**

`AGENTS.md` wraps its content in `<!-- convex-ai-start -->` / `<!-- convex-ai-end -->`. Append **after** the closing marker, so `npx convex ai-files install` cannot overwrite it. Add the identical block to both files:

```markdown

## Contributors

If `git config user.email` is not `bdoggett@gmail.com`, load the `contributing`
skill before any other work in this repo — before answering, before exploring,
before editing. It sets a branch-only workflow that a session hook also
enforces.
```

- [ ] **Step 2: Verify placement**

```bash
tail -8 AGENTS.md
grep -n "convex-ai-end" AGENTS.md
```

Expected: the `Contributors` heading appears *after* the `convex-ai-end` line.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: point contributor sessions at the contributing skill"
```

---

### Task 9: Protect main on GitHub, and write the owner checklist

The layer that does not depend on anyone's machine. **Owner-only** — these
commands need admin rights on the repo.

**Files:**
- Create: `docs/onboarding-a-contributor.md`
- No source changes.

**Interfaces:**
- Consumes: nothing.
- Produces: a GitHub ruleset named `protect-main`, and the checklist the owner works through once per contributor.

- [ ] **Step 1: Confirm the starting state**

```bash
gh api repos/bhdoggett/word-craft/rulesets --jq 'length'
gh repo view bhdoggett/word-craft --json visibility --jq '.visibility'
```

Expected: `0` and `PUBLIC`. Public is what makes rulesets free; if this ever
turns private, rulesets need a paid plan.

- [ ] **Step 2: Create the ruleset**

```bash
gh api repos/bhdoggett/word-craft/rulesets -X POST --input - <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    }
  ]
}
JSON
```

`actor_id: 5` with `actor_type: RepositoryRole` is the repository admin role,
which keeps the owner able to push to `main` directly. Step 3 verifies that
this is actually what it does — do not take it on faith.

- [ ] **Step 3: Verify the ruleset, from both sides**

Owner still has a way through:

```bash
git checkout main && git pull
git commit --allow-empty -m "chore: verify main protection bypass"
git push origin main && echo "OWNER BYPASS OK"
```

If that push is **rejected**, the bypass actor is wrong. Read the ruleset back
with `gh api repos/bhdoggett/word-craft/rulesets/<id>` and correct
`bypass_actors` with a `PUT`, then re-test. Do not leave this half-verified: a
ruleset that blocks the owner too will be disabled in frustration, and then
nothing is protected.

The rules are actually on:

```bash
gh api repos/bhdoggett/word-craft/rulesets --jq '.[] | {name, enforcement}'
gh api repos/bhdoggett/word-craft/rulesets/<id> --jq '.rules[].type'
```

Expected: `protect-main` / `active`, and the three rule types
`deletion`, `non_fast_forward`, `pull_request`.

- [ ] **Step 4: Write the owner checklist**

Create `docs/onboarding-a-contributor.md`:

```markdown
# Onboarding a contributor

Everything here is done by the repo owner, once per person. The contributor's
own steps are handled by the `contributing` skill on his machine — he does not
read this file.

## Before he starts

1. **GitHub access** — add him as a collaborator:
   `gh api repos/bhdoggett/word-craft/collaborators/<his-github-username> -X PUT -f permission=push`
   Push access lets him create branches. `main` stays protected by the
   `protect-main` ruleset regardless.

2. **Convex team** — dashboard.convex.dev → Team Settings → Members → invite by
   email, role **Developer** (not Admin — Developer cannot touch billing or
   membership). The free plan covers up to 6 developers.

   This must land **before** he runs `npm run dev`, or his backend provisions
   under a personal team of his own and you cannot see it.

3. **Send him the Google credentials** privately — `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, the same pair the project already uses. He sets them
   on his own backend; they never enter the repo.

## Once his backend exists

He sends you a `CONVEX_DEPLOYMENT` name. Add its callback address to the
existing Google OAuth client in the Google Cloud Console, alongside the ones
already there:

```
https://<his-deployment>.convex.site/api/auth/callback/google
```

Leave Authorised JavaScript origins empty — see `auth-setup.md` for why. Until
you do this, his sign-in fails with `redirect_uri_mismatch` and nothing on his
side can fix it.

## Day to day

His work arrives as draft pull requests. GitHub emails you when one opens.
Review the diff, comment inline, and merge when you are happy. He cannot merge,
and the ruleset means neither can anything running on his machine.

## Revoking access

Remove the repo collaborator, remove him from the Convex team, and delete the
extra redirect URI from the Google OAuth client. His local clone keeps working
against a backend he no longer has access to, which fails on its own.
```

- [ ] **Step 5: Commit**

```bash
git add docs/onboarding-a-contributor.md
git commit -m "docs: add the contributor onboarding checklist"
```

---

### Task 10: Whole-system verification

Everything so far was verified in pieces. This runs it as one system, from a
clean clone, the way it will actually arrive.

**Files:** none — this task changes nothing.

- [ ] **Step 1: Confirm the full test suite is green**

```bash
npm test
npm run lint
```

Expected: PASS for all three vitest projects (`engine`, `convex`, `hooks`), and
a clean lint. If eslint objects to `.claude/hooks/*.mjs`, add `.claude/**` to
the ignore list in `eslint.config.js` — the hooks are not application code and
are covered by their own tests.

- [ ] **Step 2: Confirm exactly the intended files are tracked**

```bash
git ls-files .claude
```

Expected, and nothing else:

```
.claude/hooks/contributor-mode.mjs
.claude/hooks/contributor-mode.test.mjs
.claude/hooks/guardrails.mjs
.claude/hooks/guardrails.entry.test.mjs
.claude/hooks/lib/guardrails.mjs
.claude/hooks/lib/guardrails.test.mjs
.claude/hooks/lib/repo.mjs
.claude/hooks/lib/repo.test.mjs
.claude/settings.json
.claude/skills/contributing/SKILL.md
.claude/skills/contributing/references/convex-local.md
.claude/skills/contributing/references/first-time-setup.md
.claude/skills/contributing/references/git-workflow.md
.claude/skills/contributing/references/troubleshooting.md
```

A single `.claude/skills/convex-*/` path in that list means the `.gitignore`
carve-out is wrong — 368K of generated files would ship and conflict on every
update.

- [ ] **Step 3: Rehearse the clone**

```bash
cd "$(mktemp -d)"
git clone https://github.com/bhdoggett/word-craft.git
cd word-craft
git config user.email "brother@example.com"
git config user.name "Test Contributor"
ls .claude/hooks .claude/skills
```

Expected: both hooks, the lib, and the skill are present in a fresh clone with
no extra setup.

- [ ] **Step 4: Rehearse a contributor session**

In that clone, start a Claude Code session and confirm, in order:

1. It announces contributor mode without being asked.
2. Given a code request, it creates a branch, pushes it, and opens a draft PR
   **before** editing anything.
3. `git push origin main` is denied, with a reason a non-coder could act on.
4. `npx convex deploy` is denied.
5. It explains what it did without using the words commit, push, branch, or
   merge.

Fix anything that fails here in the file that owns it, then re-run this step.
This rehearsal is the actual acceptance test for the whole plan — the unit
tests only prove the parts work.

- [ ] **Step 5: Clean up the rehearsal**

```bash
gh pr close <the draft PR number>
git push origin --delete <the rehearsal branch>
cd - && rm -rf "$OLDPWD"
```

- [ ] **Step 6: Final commit**

Nothing should be left to commit. Confirm:

```bash
git status --short
```

Expected: empty.

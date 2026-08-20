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
    matches: (command, context) => {
      if (/git\s+push\b[^&|;]*\bmain\b/.test(command)) return true;
      // A `git push` with no branch actually spelled out pushes the current
      // branch to its upstream (push.default=simple). If that current
      // branch is main, this is just as much a push-to-main as spelling it
      // out literally — whether the command is bare (`git push`) or names
      // only a remote (`git push origin`), since a lone remote name is not
      // a branch. A second positional token, or a refspec (`HEAD:branch`)
      // packed into the first, is what makes the destination explicit.
      if (context?.branch !== "main") return false;
      const pushArgs = /git\s+push\b([^&|;]*)/.exec(command);
      if (!pushArgs) return false;
      const positional = pushArgs[1]
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !token.startsWith("-"));
      if (positional.length === 0) return true;
      if (positional.length === 1 && !positional[0].includes(":")) return true;
      return false;
    },
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
    matches: (command) => {
      const branchArgs = /git\s+branch\b([^&|;]*)/.exec(command);
      if (!branchArgs) return false;
      const tokens = branchArgs[1].trim().split(/\s+/).filter(Boolean);
      // Force and delete can arrive as separate long flags (--force
      // --delete, either order), separate short flags (-f -d, either
      // order), or clustered into one short token in any order and any
      // case (-D, -Df, -fd, -fD, ...) — capital D alone already means
      // "delete, forced". `--delete`/`-d` alone, with no force anywhere,
      // stays allowed — that's the safe delete.
      let hasForce = false;
      let hasDelete = false;
      for (const token of tokens) {
        if (token === "--force") hasForce = true;
        else if (token === "--delete") hasDelete = true;
        else if (/^-[A-Za-z]+$/.test(token)) {
          const letters = token.slice(1);
          if (letters.includes("D")) {
            hasForce = true;
            hasDelete = true;
          }
          if (letters.includes("d")) hasDelete = true;
          if (letters.toLowerCase().includes("f")) hasForce = true;
        }
      }
      return hasForce && hasDelete;
    },
    reason:
      "Deleting a branch with force removes it even when it holds work that was never sent to GitHub. " +
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

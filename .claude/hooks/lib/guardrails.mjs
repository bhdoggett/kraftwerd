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
 * `git` followed by an optional run of `-C <path>` / `-c <key>=<value>`
 * prefix flags, then the mandatory whitespace before the subcommand verb.
 * Every git-verb rule below is anchored on this instead of a bare `git\s+`,
 * so `git -C /path push origin main` and `git -c user.email=x commit` are
 * still recognised by the verb they actually run.
 *
 * A plain string (not a RegExp literal) so it can be spliced into other
 * patterns with `new RegExp(...)`.
 */
const GIT_PREFIX = String.raw`git(?:\s+-C\s+\S+|\s+-c\s+\S+)*\s+`;

/**
 * Every occurrence of `git <verb>` in the command, each with its own
 * argument run. A single `.exec()` only ever finds the FIRST occurrence,
 * which would let an innocent invocation early in a chained or multi-line
 * command (`git push origin sam/topic && git push origin main`) hide a
 * dangerous one later in the same string. `matchAll` walks all of them.
 */
function allOccurrences(command, verb) {
  const re = new RegExp(GIT_PREFIX + verb + "\\b([^&|;\\n]*)", "g");
  return [...command.matchAll(re)].map((match) => match[1]);
}

// Strips one layer of matching quotes so `git push origin "main"` reads the
// same as `git push origin main`.
function stripQuotes(token) {
  if (
    token.length >= 2 &&
    ((token[0] === '"' && token[token.length - 1] === '"') ||
      (token[0] === "'" && token[token.length - 1] === "'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

// `main`, and the same ref spelled as `heads/main` or `refs/heads/main`.
function isMainRef(ref) {
  return ref === "main" || ref === "heads/main" || ref === "refs/heads/main";
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
      // `[^&|;\n]*` deliberately stops at a newline as well as the other
      // command separators — otherwise a multi-line heredoc block (push on
      // line one, an unrelated `main` on line two, e.g. `gh pr create
      // --base main`) gets scanned as one command and denied for a `main`
      // that was never the push's own destination. Each `git push` in the
      // command is then inspected on its own, so a later push can't hide
      // behind an earlier innocent one in the same chained/multi-line command.
      const occurrences = allOccurrences(command, "push");
      for (const argString of occurrences) {
        const positional = argString
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .filter((token) => !token.startsWith("-"));

        // An explicit destination: a positional argument that names `main`
        // as a whole ref — bare, quoted, `heads/main`, `refs/heads/main`,
        // or as the destination side of a `src:dst` refspec. This is
        // checked token-by-token rather than `\bmain\b` against the raw
        // string so a branch name that merely contains "main" — eg.
        // `sam/fix-main-menu` — is never caught.
        for (const rawToken of positional) {
          const token = stripQuotes(rawToken);
          const dst = token.includes(":") ? token.slice(token.indexOf(":") + 1) : token;
          if (isMainRef(dst)) return true;
        }

        // A `git push` with no branch actually spelled out pushes the
        // current branch to its upstream (push.default=simple). If that
        // current branch is main, this is just as much a push-to-main as
        // spelling it out literally — whether the command is bare
        // (`git push`) or names only a remote (`git push origin`), since a
        // lone remote name is not a branch. A second positional token, or a
        // refspec (`HEAD:branch`) packed into the first, is what makes the
        // destination explicit.
        if (context?.branch === "main") {
          if (positional.length === 0) return true;
          if (positional.length === 1 && !positional[0].includes(":")) return true;
        }
      }
      return false;
    },
    reason:
      "That would send code straight to the main branch, which is the version everyone else uses. " +
      "Work always goes onto its own branch first. Instead: push to the branch you are working on, " +
      "then open a draft pull request so Ben can look it over.",
  },
  {
    id: "force-push",
    matches: (command) => {
      // Every `git push` in the command is checked on its own — an
      // innocent first push (`git push origin ben/x && git push -f ...`)
      // must not hide a forced one later in the same command.
      for (const argString of allOccurrences(command, "push")) {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
        for (const token of tokens) {
          if (token === "--force" || token === "--force-with-lease") return true;
          if (token.startsWith("--force-with-lease=")) return true;
          if (token.startsWith("+")) return true; // a `+refspec` forces on its own
          // Clustered short flags, e.g. `-uf` or `-fu`, force just as much
          // as a lone `-f` — the branch-delete rule below handles the same
          // shape.
          if (/^-[A-Za-z]+$/.test(token) && token.slice(1).includes("f")) return true;
        }
      }
      return false;
    },
    reason:
      "A force push overwrites history on GitHub and can erase work that is already saved there. " +
      "Instead: make a normal push. If it is rejected because the branch moved, bring in the latest " +
      "changes with `git merge origin/main` and push again.",
  },
  {
    id: "reset-hard",
    matches: (command) => new RegExp(GIT_PREFIX + "reset\\b[^&|;\\n]*--hard\\b").test(command),
    reason:
      "This throws away uncommitted work permanently, with no undo. " +
      "Instead: save the work on the current branch, or say what should be undone and it can be " +
      "reversed with a new commit that keeps the history intact.",
  },
  {
    id: "rebase",
    matches: (command) => {
      if (new RegExp(GIT_PREFIX + "rebase\\b").test(command)) return true;
      // `git pull --rebase` (or its `-r` shorthand) rebases under the hood.
      // It is the single likeliest command to show up right after a
      // rejected push, and recovering from a bad one needs a force push,
      // which is also blocked — so it gets caught here too.
      return allOccurrences(command, "pull").some((argString) => {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
        return tokens.some(
          (token) =>
            token === "--rebase" ||
            token.startsWith("--rebase=") ||
            token === "-r" ||
            (/^-[A-Za-z]+$/.test(token) && token.slice(1).includes("r")),
        );
      });
    },
    reason:
      "Rebasing rewrites history, and recovering from a bad one needs a force push, which is also " +
      "blocked. `git pull --rebase` does the same thing under the hood, so it is included here too. " +
      "Instead: use `git merge origin/main` to bring in the latest changes. It is additive and never " +
      "destroys work.",
  },
  {
    id: "pull-on-main",
    matches: (command, context) =>
      context?.branch === "main" && new RegExp(GIT_PREFIX + "pull\\b").test(command),
    reason:
      "Local main is never pulled — `origin/main` is the reference, and pulling into local main is how " +
      "it drifts and conflicts. Instead: `git fetch origin` brings the reference current without " +
      "touching the working tree; new work branches from `origin/main` directly.",
  },
  {
    id: "force-delete-branch",
    matches: (command) => {
      // Force and delete can arrive as separate long flags (--force
      // --delete, either order), separate short flags (-f -d, either
      // order), or clustered into one short token in any order and any
      // case (-D, -Df, -fd, -fD, ...) — capital D alone already means
      // "delete, forced". `--delete`/`-d` alone, with no force anywhere,
      // stays allowed — that's the safe delete. Every `git branch` in the
      // command is checked on its own, so a safe delete earlier in a
      // chained command can't hide a forced one later.
      return allOccurrences(command, "branch").some((argString) => {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
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
      });
    },
    reason:
      "Deleting a branch with force removes it even when it holds work that was never sent to GitHub. " +
      "Instead: use `git branch -d`, which refuses to delete anything that would be lost.",
  },
  {
    id: "discard-work",
    matches: (command) => {
      // Every occurrence of each verb is checked independently — the same
      // "first innocent call hides a later dangerous one" gap that applied
      // to push also applies here (`git clean -n && git clean -fdx`).
      for (const argString of allOccurrences(command, "clean")) {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
        for (const token of tokens) {
          if (token === "--force") return true;
          if (/^-[A-Za-z]+$/.test(token) && token.slice(1).includes("f")) return true;
        }
      }
      for (const argString of allOccurrences(command, "checkout")) {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
        if (tokens.includes("--")) return true;
      }
      for (const argString of allOccurrences(command, "restore")) {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
        const hasWorktree = tokens.includes("--worktree");
        const hasStaged = tokens.includes("--staged");
        // A pure `--staged` restore only unstages — it never touches the
        // working tree, so it is the one safe shape and stays allowed.
        if (hasWorktree || !hasStaged) return true;
      }
      return false;
    },
    reason:
      "This throws away uncommitted work in the working tree, with no undo. " +
      "Instead: save it first with `git add` and `git commit` — say what should change instead and it " +
      "can be undone with a new commit that keeps the history intact.",
  },
  {
    id: "set-identity",
    matches: (command) => {
      // `git -c user.email=... <anything>` sets the identity inline for
      // that one call, regardless of which verb follows.
      if (/-c\s+(user\.email|user\.name)\s*=/.test(command)) return true;
      // Every `git config` in the command is checked on its own — a bare
      // read ("check it first") must not hide a write later in the same
      // command, which is exactly the "check then set" pair an agent
      // produces after git refuses to commit with no identity configured.
      return allOccurrences(command, "config").some((argString) => {
        const tokens = argString.trim().split(/\s+/).filter(Boolean);
        const nonFlags = tokens.filter((token) => !token.startsWith("-"));
        const keyIndex = nonFlags.findIndex(
          (token) => token === "user.email" || token === "user.name",
        );
        if (keyIndex === -1) return false;
        // A value after the key means this call writes it. `git config
        // user.email` with nothing after it only reads the current value —
        // the hooks themselves rely on being able to do exactly that.
        return keyIndex < nonFlags.length - 1;
      });
    },
    reason:
      "This rewrites the git identity the guardrails use to tell you apart from Ben, and every " +
      "guardrail reads it — getting it wrong turns all of them off without any warning. " +
      "Instead: ask Ben if the identity looks wrong. Do not set it yourself.",
  },
  {
    id: "pr-merge",
    matches: (command) =>
      /gh\s+pr\s+merge\b/.test(command) ||
      /gh\s+api\b[^&|;\n]*(-X|--method)\s+(PUT|POST)\b[^&|;\n]*\/merge\b/i.test(command),
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
    matches: (command) =>
      /--prod\b/.test(command) ||
      (/\bconvex\b/.test(command) && /--(url|deployment-name)\b/.test(command)) ||
      /(^|[\s;&|])(CONVEX_DEPLOY_KEY|CONVEX_DEPLOYMENT)=/.test(command),
    reason:
      "This points at (or could point at) the live app that real people are using — via --prod, an " +
      "explicit --url or --deployment-name, or a CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT environment " +
      "variable. Instead: run the same command with no deployment target and it uses your own private copy.",
  },
  {
    id: "commit-on-main",
    matches: (command, context) =>
      context?.branch === "main" && new RegExp(GIT_PREFIX + "commit\\b").test(command),
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

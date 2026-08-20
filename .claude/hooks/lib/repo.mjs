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

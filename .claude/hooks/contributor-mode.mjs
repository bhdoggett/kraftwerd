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
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: CONTEXT,
        },
        systemMessage: "Contributor mode: branch-only workflow and command guardrails are active.",
      }),
    );
  }
} catch {
  // Silent by design: a broken session hook must not break the session.
}

process.exit(0);

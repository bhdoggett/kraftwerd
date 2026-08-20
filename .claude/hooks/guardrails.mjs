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
